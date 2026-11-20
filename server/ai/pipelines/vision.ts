import { inspectText } from '../../../shared/guardrails'
import { dropCutoffTail, recoverPopqGrids, reflowTranscription, type ImageKind } from '../../../shared/page-images'
import { AiUnavailableError, callStructured, type AttemptLog } from '../client'
import { VISION_SYSTEM } from '../prompts'
import { visionSchema, type VisionBatch } from '../schemas'

/**
 * Etapa de VISÃO do importador: recortes JPEG das imagens das páginas → transcrição fiel
 * (quadro POP-Q, foto/print de enunciado, tabela, figura). Uma chamada por LOTE de até
 * `VISION_BATCH` imagens (cadeia `vision` de models.ts, só modelos `:free`).
 *
 * Usada pelo nó `vision` do grafo (avaliação/servidor com acesso às imagens) e pela rota
 * `POST /api/imports/:id/images` (o navegador envia os recortes; nada é armazenado).
 * Medição: docs/10 §7.
 */

/** Imagens por requisição: lotes pequenos (modelos de raciocínio obrigatório) e corpo < 4,5 MB na Vercel. */
export const VISION_BATCH = 3
/** Tentativas por imagem: a 2ª é sozinha (1 imagem por chamada), depois vira `[Imagem p. N]` para revisão. */
export const VISION_MAX_ATTEMPTS = 2
/** Tamanho máximo de UM recorte em base64 (~1,1 MB de JPEG); o navegador gera ~40–100 KB. */
export const MAX_IMAGE_BASE64 = 1_500_000
/** Corpo total de um lote (base64) — folga dentro dos 4,5 MB da função Vercel. */
export const MAX_BATCH_BASE64 = 4_000_000

export interface PageImageInput {
  id: string
  page: number
  /** JPEG/PNG em base64, sem o prefixo `data:`. */
  base64: string
  mediaType?: 'image/jpeg' | 'image/png'
}

export interface ImageResult {
  id: string
  page: number
  status: 'ok' | 'falhou'
  kind?: ImageKind
  text?: string | null
  model?: string
}

const POPQ_POINTS = ['aa', 'ba', 'c', 'hg', 'cp', 'cvt', 'ap', 'bp', 'd']

type VisionItem = VisionBatch['imagens'][number]

/** Problema de UM item (vira falha só daquela imagem, que é tentada de novo sozinha). */
export function visionItemProblem(it: VisionItem): string | null {
  // Degeneração medida no nemotron-VL ("QUESTÃO 2 2 2 2 2…" até o limite de tokens): falha → 2ª tentativa sozinha
  if (/(\S+)(?:\s+\1){12,}/.test(it.transcricao)) return `Imagem ${it.id}: transcrição repetitiva — transcreva só o que está na imagem.`
  if (it.tipo !== 'pop_q') return null
  const found = POPQ_POINTS.filter((p) => new RegExp(`(^|[^a-z])${p}\\s*[:=]?\\s*([+\\-−–]?\\s*\\d|—|-{1,3}(?!\\d))`, 'i').test(it.transcricao))
  return found.length < 7 ? `Imagem ${it.id}: use o formato "POP-Q — Aa <v>; Ba <v>; C <v>; HG <v>; CP <v>; CVT <v>; Ap <v>; Bp <v>; D <v>".` : null
}

/**
 * Checagem de qualidade do LOTE (vira dica de reparo / troca de modelo): ids inventados ou menos da
 * metade das imagens aproveitáveis. Falhas isoladas não derrubam o lote — medido em docs/10 §7:
 * reprovar o lote inteiro por um item jogava fora transcrições boas e caía em modelos com 429.
 */
export function checkVision(v: VisionBatch, ids: string[]): string | null {
  const got = v.imagens.map((i) => i.id.trim())
  const extra = got.filter((id) => !ids.includes(id))
  if (extra.length) return `ids inexistentes: ${extra.join(', ')}. Use exatamente os imagem_id recebidos.`
  const usable = v.imagens.filter((it) => !visionItemProblem(it))
  if (usable.length * 2 >= ids.length) return null
  const missing = ids.filter((id) => !got.includes(id))
  if (missing.length) return `Faltou transcrever: ${missing.join(', ')}. Devolva um item para cada imagem_id.`
  return v.imagens.map(visionItemProblem).find(Boolean) ?? null
}

/** Normaliza a saída: guardrail no texto transcrito (a imagem também pode carregar injeção), limites, POP-Q. */
export function cleanTranscription(kind: ImageKind, raw: string): { text: string; risky: boolean } {
  // o nemotron-VL às vezes separa linhas com "<br>" em vez de "\n"
  const g = inspectText(raw.replace(/<br\s*\/?>/gi, '\n'))
  let text = g.clean.trim().slice(0, 6000)
  // fragmento da questão seguinte cortado na borda da foto não vira questão parcial (shared/page-images.ts)
  if (kind === 'texto') text = dropCutoffTail(reflowTranscription(text))
  // quadro POP-Q "achatado" ("+2 Aa +1 Ba…") → "POP-Q — Aa +2; Ba +1; …" (shared/page-images.ts)
  if (kind === 'texto' || kind === 'pop_q') text = recoverPopqGrids(text)
  // linhas de quadro POP-Q (sozinho ou dentro de um texto): "Ba - 3" / "Aa + 1" / "C −7" → "Ba -3" / "Aa +1" / "C -7"
  const normPopq = (l: string) => l.replace(/\s+/g, ' ').replace(/([;:—]|\b[A-Za-z]{1,3})\s*([+\-−–])\s*(?=\d)/g, (_, k: string, s: string) => `${k} ${s === '+' ? '+' : '-'}`)
  text = text
    .split('\n')
    .map((l) => (/POP-?Q\s*[—–-]/i.test(l) ? normPopq(l).trim() : l))
    .join('\n')
  return { text, risky: g.risk === 'alto' }
}

export interface DescribeOptions {
  userId?: string
  deadline?: number
  reserveAiRequest: () => Promise<void>
  onAttempt?: (log: AttemptLog) => void
}

/**
 * Transcreve UM lote (≤ VISION_BATCH imagens) numa requisição com fallback.
 * Nunca lança por indisponibilidade da IA: devolve `status: 'falhou'` (a questão segue com `[Imagem p. N]`).
 */
export async function describeImageBatch(batch: PageImageInput[], opts: DescribeOptions): Promise<{ results: ImageResult[]; warnings: string[] }> {
  const ids = batch.map((b) => b.id)
  const failed = (why: string) => ({
    results: batch.map((b) => ({ id: b.id, page: b.page, status: 'falhou' as const, text: null })),
    warnings: [`Visão indisponível para ${ids.join(', ')} (${why}) — as questões seguem com "[Imagem p. N]" para revisão.`],
  })
  if (!batch.length) return { results: [], warnings: [] }
  try {
    await opts.reserveAiRequest()
    const r = await callStructured({
      task: 'vision',
      userId: opts.userId,
      deadline: opts.deadline,
      schema: visionSchema,
      system: VISION_SYSTEM,
      prompt: `Transcreva ${batch.length} imagem(ns) recortada(s) de páginas de um PDF de questões. imagem_id na ordem: ${ids.join(', ')}.`,
      images: batch.map((b) => ({ label: `imagem_id: ${b.id} (página ${b.page})`, base64: b.base64, mediaType: b.mediaType ?? 'image/jpeg' })),
      quality: (v) => checkVision(v, ids),
      onAttempt: opts.onAttempt,
    })
    const warnings = r.value.alertas.length ? [`Visão (${ids.join(', ')}): ${r.value.alertas.join('; ').slice(0, 300)}`] : []
    const results = batch.map((b): ImageResult => {
      const it = r.value.imagens.find((x) => x.id.trim() === b.id)
      if (!it || visionItemProblem(it)) return { id: b.id, page: b.page, status: 'falhou', text: null }
      const { text, risky } = cleanTranscription(it.tipo, it.transcricao)
      if (risky) warnings.push(`Imagem ${b.id}: conteúdo suspeito removido da transcrição.`)
      return { id: b.id, page: b.page, status: 'ok', kind: it.tipo, text: it.tipo === 'decorativa' ? '' : text, model: r.model }
    })
    return { results, warnings }
  } catch (err) {
    if (err instanceof AiUnavailableError) return failed('nenhum modelo de visão respondeu')
    throw err
  }
}

/** Agrupa imagens em lotes de até VISION_BATCH e MAX_BATCH_BASE64 (mesma regra no navegador). */
export function batchImages<T extends { base64: string }>(images: T[], maxItems = VISION_BATCH, maxBytes = MAX_BATCH_BASE64): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let size = 0
  for (const img of images) {
    if (cur.length && (cur.length >= maxItems || size + img.base64.length > maxBytes)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(img)
    size += img.base64.length
  }
  if (cur.length) out.push(cur)
  return out
}
