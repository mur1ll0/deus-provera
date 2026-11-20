import { inspectText, wrapUntrusted, type RiskLevel } from '../../../shared/guardrails'
import { fullTextWithImages, imageDescriptionsIn, missingImageBrackets, type ImageKind } from '../../../shared/page-images'
import { importQuestionSchema, type ImportQuestion } from '../../../shared/schemas/import'
import { heuristicKeyPoints, segmentQuestions, type SegmentedQuestion } from '../../../shared/segmenter'
import { AiUnavailableError, callStructured, type AttemptLog } from '../client'
import { END, StateGraph, type GraphState } from '../graph'
import { CLASSIFY_SYSTEM, DISTRACTORS_SYSTEM, GUARD_SYSTEM, STRUCTURE_SYSTEM } from '../prompts'
import { checkDistractors, checkGrounding } from '../quality'
import { classificationSchema, distractorsSchema, guardSchema, structuredBatchSchema } from '../schemas'
import { describeImageBatch, VISION_BATCH, VISION_MAX_ATTEMPTS, type PageImageInput } from './vision'

/**
 * Pipeline de importação (PDF → questões revisáveis). Questão = ENUNCIADO + PERGUNTAS.
 *
 *   guard ──► vision ◄─┐ (loop por lote de imagens, quando há recortes a transcrever)
 *               │      │
 *               ├──────┘
 *               ▼
 *            segment ──► structure ◄─┐ (loop por lote)
 *                             │       │
 *                             ├───────┘
 *                             ▼
 *                         classify ──► distractors ◄─┐ (opcional, loop por lote de PERGUNTAS)
 *                                          │         │
 *                                          ├─────────┘
 *                                          ▼
 *                                       validate ──► END (status "revisao": usuário revisa os cards)
 *
 * Toda falha de IA tem fallback determinístico — o usuário nunca perde o conteúdo, só recebe
 * itens marcados como "revisar". Qualidade medida por `npm run eval:import` (docs/10-avaliacao-importador.md).
 */

export interface Block {
  id: string
  /** Texto do bloco como foi segmentado (fonte do grounding). */
  text: string
  /** Segmentação determinística (base do fallback). */
  seg: SegmentedQuestion
  risk: RiskLevel
}

export interface DraftItem extends ImportQuestion {
  id: string
  blockId: string
  resumo?: string
  flags: string[]
}

export interface Card {
  area: string
  disciplina: string
  assunto: string
  descricao: string
  questionIds: string[]
}

/**
 * Imagem de página (marcador `[[imagem pN-k]]` no texto). `pendente` = ainda não transcrita;
 * `ignorada` = o recorte nunca chegou (o navegador não enviou / sem visão) → vira `[Imagem p. N]`.
 */
export interface PageImageState {
  page: number
  status: 'pendente' | 'ok' | 'falhou' | 'ignorada'
  kind?: ImageKind
  text?: string | null
  model?: string
  /** Tentativas feitas (a 2ª é sozinha; ver VISION_MAX_ATTEMPTS). */
  attempts?: number
}

/** Atualiza o estado das imagens com o resultado de um lote: falha volta a `pendente` até esgotar as tentativas. */
export function applyImageResults(images: Record<string, PageImageState>, results: { id: string; page: number; status: 'ok' | 'falhou'; kind?: ImageKind; text?: string | null; model?: string }[], ids: { id: string; page: number }[]) {
  const next = { ...images }
  for (const b of ids) {
    const r = results.find((x) => x.id === b.id)
    const attempts = (images[b.id]?.attempts ?? 0) + 1
    next[b.id] =
      r?.status === 'ok'
        ? { page: b.page, status: 'ok', kind: r.kind, text: r.text, model: r.model, attempts }
        : { page: b.page, status: attempts < VISION_MAX_ATTEMPTS ? 'pendente' : 'falhou', attempts }
  }
  return next
}

/** Próximo lote: imagens novas de 3 em 3; as que já falharam uma vez vão sozinhas. */
export function nextImageBatch(images: Record<string, PageImageState>): { id: string; page: number }[] {
  const pending = Object.entries(images)
    .filter(([, v]) => v.status === 'pendente')
    .map(([id, v]) => ({ id, page: v.page, attempts: v.attempts ?? 0 }))
    .sort((a, b) => a.attempts - b.attempts)
  if (!pending.length) return []
  const round = pending[0].attempts
  return pending
    .filter((p) => p.attempts === round)
    .slice(0, round ? 1 : VISION_BATCH)
    .map(({ id, page }) => ({ id, page }))
}

export interface ImportState extends GraphState {
  nonce: string
  options: { generateDistractors: boolean }
  /** Texto das páginas; pode conter `[[imagem pN-k]]` (resolvidos no nó `segment`). */
  rawPages: { page: number; text: string }[]
  /** Imagens das páginas (etapa de visão). Ausente em jobs antigos. */
  images?: Record<string, PageImageState>
  blocks: Block[]
  pendingBatches: string[][]
  /** Lotes de perguntas para distratores: "questionId#índiceDaPergunta". */
  pendingDistractors: string[][]
  drafts: Record<string, DraftItem>
  cards: Card[]
  warnings: string[]
  aiLog: AttemptLog[]
  guardRisk: RiskLevel
}

export interface ImportCtx {
  userId: string
  /** Taxonomia existente (global + do usuário), formatada para o prompt de classificação. */
  taxonomy: string
  /** Reserva 1 requisição do orçamento diário; lança erro se esgotado. */
  reserveAiRequest: () => Promise<void>
  /** Prazo absoluto do passo atual (função Vercel): repassado a callStructured para cortar o fallback a tempo. */
  deadline?: number
  /**
   * Recortes JPEG das imagens pendentes (etapa de visão dentro do grafo). Na avaliação em Node
   * (scripts/eval-import.ts) renderiza do PDF. Em produção o PDF não chega ao servidor: o navegador
   * envia os recortes a `POST /api/imports/:id/images` antes de `/run`, então aqui fica indefinido e
   * imagens ainda pendentes viram `ignorada`.
   */
  loadImages?: (ids: { id: string; page: number }[]) => Promise<PageImageInput[]>
}

// Lotes pequenos: modelos gratuitos de raciocínio obrigatório gastam ~4,8 mil tokens pensando por questão (models.ts).
const MAX_BATCH_CHARS = 6_000
const MAX_BATCH_ITEMS = 3
const RISK_ORDER: RiskLevel[] = ['baixo', 'medio', 'alto']

function chunkBy<T>(items: T[], size: (t: T) => number, maxSize: number, maxItems: number): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let curSize = 0
  for (const it of items) {
    const s = size(it)
    if (cur.length && (curSize + s > maxSize || cur.length >= maxItems)) {
      out.push(cur)
      cur = []
      curSize = 0
    }
    cur.push(it)
    curSize += s
  }
  if (cur.length) out.push(cur)
  return out
}

const blockText = (s: SegmentedQuestion) =>
  [s.sourceLabel, s.stem, ...s.items.map((it) => [it.label && `${it.label})`, it.prompt, it.answer].filter(Boolean).join(' '))].filter(Boolean).join('\n')

/** Imagens transcritas dentro do bloco → `tem_imagem` / `descricao_imagem` (sem IA extra). */
function imageFields(text: string): Pick<DraftItem, 'tem_imagem' | 'descricao_imagem'> {
  const desc = imageDescriptionsIn(text)
  return desc.length ? { tem_imagem: true, descricao_imagem: desc.join('\n').slice(0, 2000) } : {}
}

/** Fallback sem IA: a própria segmentação vira o rascunho (discursivas, pontos-chave heurísticos). */
function draftFromSegment(b: Block, flags: string[]): DraftItem {
  return {
    id: b.id,
    blockId: b.id,
    area: 'Sem área',
    disciplina: 'Sem disciplina',
    ...imageFields(b.text),
    rotulo: b.seg.sourceLabel ?? null,
    enunciado: b.seg.stem.slice(0, 12000) || '(enunciado não identificado)',
    perguntas: b.seg.items.map((it) => ({
      rotulo: it.label ?? null,
      texto: it.prompt,
      tipo: 'discursiva' as const,
      resposta_esperada: it.answer ?? null,
      pontos_chave: heuristicKeyPoints(it.answer),
      alternativas: null,
    })),
    pagina: b.seg.page,
    flags,
  }
}

export const importGraph = new StateGraph<ImportState, ImportCtx>()
  /* 1. Guardrail determinístico em todo o texto + classificador LLM nos trechos de risco alto */
  .addNode('guard', async (s, ctx) => {
    let worst: RiskLevel = 'baixo'
    const warnings: string[] = []
    const rawPages = await Promise.all(
      s.rawPages.map(async (p) => {
        const r = inspectText(p.text)
        if (RISK_ORDER.indexOf(r.risk) > RISK_ORDER.indexOf(worst)) worst = r.risk
        if (r.risk === 'alto') {
          await ctx.reserveAiRequest()
          try {
            const g = await callStructured({ task: 'guard', userId: ctx.userId, deadline: ctx.deadline, schema: guardSchema, system: GUARD_SYSTEM(s.nonce), prompt: wrapUntrusted(r.clean.slice(0, 6000), s.nonce) })
            if (g.value.suspeito) warnings.push(`Página ${p.page}: conteúdo suspeito removido (${g.value.motivos.join(', ')})`)
          } catch {
            warnings.push(`Página ${p.page}: conteúdo suspeito removido pelo filtro determinístico`)
          }
        }
        return { page: p.page, text: r.clean }
      }),
    )
    return { rawPages, guardRisk: worst, warnings: [...s.warnings, ...warnings] }
  })
  .addEdge('guard', 'vision')

  /*
   * 2. Visão: transcreve os recortes de imagem pendentes, um lote (≤ 3) por passo, ANTES da segmentação.
   *    Em produção os recortes chegam por POST /api/imports/:id/images (antes de /run) e aqui não há
   *    pendências; sem `ctx.loadImages`, o que sobrar pendente vira "ignorada" ([Imagem p. N] na revisão).
   */
  .addNode('vision', async (s, ctx) => {
    const images = { ...(s.images ?? {}) }
    const pending = Object.entries(images)
      .filter(([, v]) => v.status === 'pendente')
      .map(([id, v]) => ({ id, page: v.page }))
    if (!pending.length) return {}
    if (!ctx.loadImages) {
      for (const p of pending) images[p.id] = { ...images[p.id], status: 'ignorada' }
      return { images, warnings: [...s.warnings, `${pending.length} imagem(ns) não foram transcritas — as questões seguem com "[Imagem p. N]" para revisão.`] }
    }
    const batch = nextImageBatch(images)
    const aiLog = [...s.aiLog]
    const loaded = await ctx.loadImages(batch).catch(() => [] as PageImageInput[])
    const { results, warnings } = await describeImageBatch(loaded, {
      userId: ctx.userId,
      deadline: ctx.deadline,
      reserveAiRequest: ctx.reserveAiRequest,
      onAttempt: (l) => aiLog.push(l),
    })
    return { images: applyImageResults(images, results, batch), aiLog, warnings: [...s.warnings, ...warnings] }
  })
  .addConditionalEdges('vision', (s) => (Object.values(s.images ?? {}).some((v) => v.status === 'pendente') ? 'vision' : 'segment'))

  /* 3. Segmentação determinística (custo zero) em questões (enunciado + perguntas) e lotes */
  .addNode('segment', async (s) => {
    // `[[imagem pN-k]]` → transcrição da visão (ou "[Imagem p. N]"), antes de separar as questões
    const fullText = fullTextWithImages(s.rawPages, s.images ?? {})
    const blocks: Block[] = segmentQuestions(fullText).map((seg, i) => {
      const text = blockText(seg)
      return { id: `b${i + 1}`, text, seg, risk: inspectText(text).risk }
    })
    const pendingBatches = chunkBy(blocks, (b) => b.text.length, MAX_BATCH_CHARS, MAX_BATCH_ITEMS).map((batch) => batch.map((b) => b.id))
    return { blocks, pendingBatches }
  })
  .addEdge('segment', 'structure')

  /* 4. Estruturação por lote com IA (grounding obrigatório) + fallback determinístico */
  .addNode('structure', async (s, ctx) => {
    const [batchIds, ...rest] = s.pendingBatches
    const byId = Object.fromEntries(s.blocks.map((b) => [b.id, b]))
    const sourceById = Object.fromEntries(batchIds.map((id) => [id, byId[id].text]))
    const drafts = { ...s.drafts }
    const aiLog = [...s.aiLog]
    try {
      await ctx.reserveAiRequest()
      const prompt = wrapUntrusted(batchIds.map((id) => `### bloco_id: ${id} (pág. ${byId[id].seg.page ?? '?'})\n${byId[id].text}`).join('\n\n'), s.nonce)
      const r = await callStructured({
        task: 'structure',
        userId: ctx.userId,
        deadline: ctx.deadline,
        schema: structuredBatchSchema,
        system: STRUCTURE_SYSTEM(s.nonce),
        prompt,
        quality: (v) => checkGrounding(v, sourceById),
        onAttempt: (l) => aiLog.push(l),
      })
      const seen = new Set<string>()
      // texto devolvido por bloco (um bloco pode virar mais de uma questão)
      const outByBlock: Record<string, string> = {}
      for (const q of r.value.questoes) outByBlock[q.bloco_id] = `${outByBlock[q.bloco_id] ?? ''}\n${q.enunciado}\n${q.perguntas.map((p) => `${p.texto}\n${p.resposta_esperada ?? ''}`).join('\n')}`
      for (const q of r.value.questoes) {
        const b = byId[q.bloco_id]
        if (!b) continue
        const id = seen.has(q.bloco_id) ? `${q.bloco_id}-${seen.size + 1}` : q.bloco_id
        const first = !seen.has(q.bloco_id)
        seen.add(q.bloco_id)
        const img = imageFields(b.text)
        // A IA às vezes omite o quadro/figura transcrito (ex.: POP-Q na página seguinte): reanexa ao enunciado
        const lost = first ? missingImageBrackets(b.text, outByBlock[q.bloco_id]) : []
        drafts[id] = {
          id,
          blockId: q.bloco_id,
          area: 'Sem área',
          disciplina: 'Sem disciplina',
          rotulo: q.rotulo ?? b.seg.sourceLabel ?? null,
          enunciado: lost.length ? `${q.enunciado}\n${lost.join('\n')}`.slice(0, 12000) : q.enunciado,
          perguntas: q.perguntas,
          dificuldade: q.dificuldade,
          tem_imagem: q.tem_imagem || !!img.tem_imagem,
          descricao_imagem: img.descricao_imagem,
          pagina: b.seg.page,
          flags: b.risk !== 'baixo' ? ['Guardrail: conteúdo suspeito removido'] : [],
        }
      }
      // Blocos que o modelo omitiu (sem "descartados") voltam pelo fallback para não perder conteúdo.
      const discarded = new Set(r.value.descartados.map((d) => d.bloco_id))
      for (const id of batchIds) if (!seen.has(id) && !discarded.has(id)) drafts[id] = draftFromSegment(byId[id], ['IA não devolveu esta questão — revise'])
      return { drafts, aiLog, pendingBatches: rest, warnings: [...s.warnings, ...r.value.alertas] }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err
      for (const id of batchIds) drafts[id] = draftFromSegment(byId[id], ['Processado sem IA — revise'])
      // (as tentativas já entraram em aiLog via onAttempt — não somar err.attempts de novo)
      return { drafts, aiLog, pendingBatches: rest, warnings: [...s.warnings, 'IA indisponível para um lote; itens marcados para revisão.'] }
    }
  })
  .addConditionalEdges('structure', (s) => (s.pendingBatches.length ? 'structure' : 'classify'))

  /* 5. Categorização em Área › Disciplina › Assunto + descrição dos cards */
  .addNode('classify', async (s, ctx) => {
    const list = Object.values(s.drafts)
    try {
      await ctx.reserveAiRequest()
      // TODO(spec 002 T033): lotes de 40 questões — 140+ questões numa chamada podem truncar a saída.
      const r = await callStructured({
        task: 'classify',
        userId: ctx.userId,
        deadline: ctx.deadline,
        schema: classificationSchema,
        system: CLASSIFY_SYSTEM(s.nonce, ctx.taxonomy),
        prompt: wrapUntrusted(list.map((d) => `id: ${d.id}\n${d.enunciado.slice(0, 400)}\n${d.perguntas.map((p) => p.texto).join(' | ').slice(0, 200)}`).join('\n---\n'), s.nonce),
      })
      const drafts = { ...s.drafts }
      const cards: Card[] = r.value.grupos.map((g) => {
        for (const q of g.questoes) if (drafts[q.id]) drafts[q.id] = { ...drafts[q.id], area: g.area, disciplina: g.disciplina, assunto: g.assunto, resumo: q.resumo }
        return { area: g.area, disciplina: g.disciplina, assunto: g.assunto, descricao: g.descricao, questionIds: g.questoes.map((q) => q.id).filter((id) => drafts[id]) }
      })
      const placed = new Set(cards.flatMap((c) => c.questionIds))
      const orphan = list.filter((d) => !placed.has(d.id)).map((d) => d.id)
      if (orphan.length) cards.push({ area: 'Sem área', disciplina: 'Sem disciplina', assunto: 'Revisar categoria', descricao: 'Questões que a IA não conseguiu classificar.', questionIds: orphan })
      return { drafts, cards }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err
      return { cards: [{ area: 'Sem área', disciplina: 'Sem disciplina', assunto: 'Revisar categoria', descricao: 'Classificação automática indisponível — organize manualmente.', questionIds: list.map((d) => d.id) }] }
    }
  })
  .addConditionalEdges('classify', (s) => (s.options.generateDistractors ? 'plan-distractors' : 'validate'))

  .addNode('plan-distractors', async (s) => {
    const targets = Object.values(s.drafts).flatMap((d) => d.perguntas.map((p, i) => ({ d, p, key: `${d.id}#${i}` }))).filter(({ p }) => p.tipo === 'discursiva' && p.resposta_esperada && !p.alternativas?.length)
    return { pendingDistractors: chunkBy(targets, () => 1, 3, 3).map((b) => b.map((t) => t.key)) }
  })
  .addConditionalEdges('plan-distractors', (s) => (s.pendingDistractors.length ? 'distractors' : 'validate'))

  /* 6. Distratores (opcional) por PERGUNTA, com checagem de qualidade */
  .addNode('distractors', async (s, ctx) => {
    const [keys, ...rest] = s.pendingDistractors
    const drafts = { ...s.drafts }
    const resolve = (key: string) => {
      const [qid, idx] = key.split('#')
      return { qid, idx: Number(idx), d: drafts[qid] }
    }
    try {
      await ctx.reserveAiRequest()
      const r = await callStructured({
        task: 'distractors',
        userId: ctx.userId,
        deadline: ctx.deadline,
        schema: distractorsSchema,
        system: DISTRACTORS_SYSTEM(s.nonce),
        prompt: wrapUntrusted(
          keys
            .map((key) => {
              const { idx, d } = resolve(key)
              const p = d.perguntas[idx]
              return `id: ${key}\nENUNCIADO: ${d.enunciado.slice(0, 1500)}\nPERGUNTA: ${p.texto || '(o próprio enunciado)'}\nRESPOSTA ESPERADA: ${p.resposta_esperada}`
            })
            .join('\n---\n'),
          s.nonce,
        ),
        quality: checkDistractors,
      })
      for (const it of r.value.itens) {
        const { qid, idx, d } = resolve(it.id)
        if (!d?.perguntas[idx]) continue
        const perguntas = [...d.perguntas]
        perguntas[idx] = {
          ...perguntas[idx],
          alternativas: [
            { texto: it.correta, correta: true, gerada_por_ia: true },
            ...it.incorretas.map((x) => ({ texto: x.texto, correta: false, explicacao: x.explicacao, gerada_por_ia: true })),
          ],
        }
        drafts[qid] = { ...d, perguntas }
      }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err
      // Sem distratores: as perguntas continuam discursivas (sem perda).
    }
    return { drafts, pendingDistractors: rest }
  })
  .addConditionalEdges('distractors', (s) => (s.pendingDistractors.length ? 'distractors' : 'validate'))

  /* 7. Validação final contra o contrato v2 */
  .addNode('validate', async (s) => {
    const drafts = { ...s.drafts }
    for (const [id, d] of Object.entries(drafts)) {
      const r = importQuestionSchema.safeParse(d)
      if (!r.success) drafts[id] = { ...d, flags: [...d.flags, ...r.error.issues.slice(0, 3).map((i) => `Validação: ${i.message}`)] }
    }
    return { drafts }
  })
  .addEdge('validate', END)
  .setEntry('guard')
