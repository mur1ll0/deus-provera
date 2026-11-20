import { detectDocumentGuide, guideForPrompt, numberQuestions, parseTaxonomyLines, resolveGuideTaxonomy, topicForQuestion, type DocumentGuide } from '../../../shared/document-guide'
import { inspectText, wrapUntrusted, type RiskLevel } from '../../../shared/guardrails'
import { fullTextWithImages, imageDescriptionsIn, missingImageBrackets, type ImageKind } from '../../../shared/page-images'
import { cleanItemLabel, importQuestionSchema, type ImportQuestion } from '../../../shared/schemas/import'
import { heuristicKeyPoints, segmentQuestions, type SegmentedQuestion } from '../../../shared/segmenter'
import { AiQuotaExhaustedError, AiUnavailableError, callStructured, type AttemptLog } from '../client'
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
 *            segment ──► structure ◄─┐ (loop por lote)   segment também lê o GUIA DO DOCUMENTO (capa, instruções, legenda de temas)
 *                             │       │
 *                             ├───────┘
 *                             ▼
 *                         classify ◄─┐ (1º o guia do documento, sem IA; depois lotes de 20 questões + 1 nova rodada p/ as que sobrarem)
 *                             ├──────┘
 *                             ▼
 *                         (plan) ──► distractors ◄─┐ (opcional, loop por lote de PERGUNTAS)
 *                                          │         │
 *                                          ├─────────┘
 *                                          ▼
 *                                       validate ──► END (status "revisao": usuário revisa os cards)
 *
 * Toda falha de IA tem fallback determinístico — o usuário nunca perde o conteúdo, só recebe
 * itens marcados como "revisar". Exceção: COTA DIÁRIA esgotada (AiQuotaExhaustedError) em `structure` /
 * `classify` PAUSA o job (checkpoint + 429 na rota, sugerindo o agente de IA próprio) em vez de gerar um
 * resultado pior em silêncio; nos distratores (opcionais) só interrompe a geração, com aviso. Qualidade medida por `npm run eval:import` (docs/10-avaliacao-importador.md).
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
  /** O que o próprio documento diz sobre a organização (título, instruções, temas por questão). Ausente em jobs antigos. */
  guide?: DocumentGuide
  pendingBatches: string[][]
  /** Lotes de questões a classificar (ids de drafts). Ausente até o nó classify rodar pela 1ª vez. */
  pendingClassify?: string[][]
  /** As questões que sobraram em "Revisar categoria" já ganharam a 2ª chance? */
  classifyRetried?: boolean
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
/**
 * Lotes de estruturação em paralelo por passo do grafo. Cada lote leva ~15 s (mediana, até ~90 s) nos modelos
 * gratuitos e quase todo o tempo é espera do modelo: 3 simultâneos cortam o tempo da importação para ~1/3 com
 * o MESMO número de requisições (ai_call de produção, 2026-11-20). 3 por usuário fica longe de 20 req/min.
 */
export const STRUCTURE_PARALLEL = 3
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

/** Card das questões que a IA não classificou (o usuário escolhe a categoria antes de salvar). */
export const UNCLASSIFIED_TOPIC = 'Revisar categoria'
/**
 * Questões por chamada de classificação. Com 85+ questões numa chamada só, a saída dos modelos gratuitos
 * vinha parcial (III UNIDADE: 3 de 85 classificadas, 2026-11-20) — o resto caía em "Revisar categoria".
 */
export const CLASSIFY_BATCH = 20

/** Fila de lotes de classificação, na ordem do documento (questões vizinhas costumam ser do mesmo assunto). */
export function planClassifyBatches(drafts: Record<string, DraftItem>, size = CLASSIFY_BATCH): string[][] {
  return chunkBy(Object.keys(drafts), () => 1, size, size)
}

/** Rótulo vindo da IA: tira caracteres de outros alfabetos (lixo de tokenização, ex.: "rastrear,従") e pontuação solta no fim. */
export function cleanLabel(text: string): string {
  return text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\uFFFD]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:–—-]+$/u, '')
    .trim()
}

const cardKey = (c: Pick<Card, 'area' | 'disciplina' | 'assunto'>) =>
  [c.area, c.disciplina, c.assunto].map((x) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()).join('|')

const isUnclassified = (c: Pick<Card, 'area' | 'assunto'>) => c.area === 'Sem área' && c.assunto === UNCLASSIFIED_TOPIC

type Grupo = { area: string; disciplina: string; assunto: string; descricao: string; questoes: { id: string; resumo?: string }[] }

/**
 * Junta o resultado de UM lote aos cards já existentes: mesmo Área › Disciplina › Assunto (sem diferença de
 * acento/caixa) vira o mesmo card; ids que a IA omitiu, inventou ou repetiu são tratados; as questões do lote
 * sem grupo vão para "Revisar categoria" (sempre o último card).
 */
export function mergeClassification(
  cards: Card[],
  drafts: Record<string, DraftItem>,
  batchIds: string[],
  grupos: Grupo[],
  orphanNote = 'Questões que a IA não conseguiu classificar.',
): { cards: Card[]; drafts: Record<string, DraftItem> } {
  const inBatch = new Set(batchIds)
  const placed = new Set<string>()
  const nextDrafts = { ...drafts }
  // Na 2ª chance as questões já estão em "Revisar categoria": saem de lá e só voltam se ficarem sem grupo de novo.
  const nextCards = cards
    .map((c) => ({ ...c, questionIds: isUnclassified(c) ? c.questionIds.filter((id) => !inBatch.has(id)) : [...c.questionIds] }))
    .filter((c) => c.questionIds.length || !isUnclassified(c))
  const find = (k: Pick<Card, 'area' | 'disciplina' | 'assunto'>) => nextCards.find((c) => cardKey(c) === cardKey(k))
  for (const g of grupos) {
    const label = { area: cleanLabel(g.area), disciplina: cleanLabel(g.disciplina), assunto: cleanLabel(g.assunto) }
    if (!label.area || !label.disciplina || !label.assunto || isUnclassified(label)) continue
    const ids = g.questoes.filter((q, i, all) => inBatch.has(q.id) && !placed.has(q.id) && nextDrafts[q.id] && all.findIndex((x) => x.id === q.id) === i)
    if (!ids.length) continue
    let card = find(label)
    if (!card) {
      card = { ...label, descricao: cleanLabel(g.descricao), questionIds: [] }
      nextCards.push(card)
    }
    for (const q of ids) {
      placed.add(q.id)
      card.questionIds.push(q.id)
      nextDrafts[q.id] = { ...nextDrafts[q.id], area: card.area, disciplina: card.disciplina, assunto: card.assunto, ...(q.resumo ? { resumo: q.resumo } : {}) }
    }
  }
  const orphan = batchIds.filter((id) => !placed.has(id) && nextDrafts[id])
  if (orphan.length) {
    let card = nextCards.find(isUnclassified)
    if (!card) {
      card = { area: 'Sem área', disciplina: 'Sem disciplina', assunto: UNCLASSIFIED_TOPIC, descricao: orphanNote, questionIds: [] }
      nextCards.push(card)
    }
    card.questionIds.push(...orphan)
  }
  nextCards.sort((a, b) => Number(isUnclassified(a)) - Number(isUnclassified(b)))
  return { cards: nextCards, drafts: nextDrafts }
}

/**
 * Próxima fila de classificação. Quando os lotes acabam, as questões que ficaram em "Revisar categoria"
 * (lote que falhou por timeout/instabilidade ou ids omitidos) ganham UMA nova rodada, em lotes menores.
 */
export function nextClassifyQueue(rest: string[][], cards: Card[], retried = false): { pendingClassify: string[][]; classifyRetried: boolean } {
  if (rest.length || retried) return { pendingClassify: rest, classifyRetried: retried }
  const left = cards.find(isUnclassified)?.questionIds ?? []
  return { pendingClassify: chunkBy(left, () => 1, CLASSIFY_BATCH / 2, CLASSIFY_BATCH / 2), classifyRetried: true }
}

/** Assunto usado quando o documento indica área/disciplina, mas não o tema, e a IA não está disponível. */
export const GUIDE_FALLBACK_TOPIC = 'Geral'

type GuideHint = { n: number | null; topic?: { assunto: string; source: string } }

/**
 * Pistas do GUIA DO DOCUMENTO por questão: número (pelo rótulo do bloco, na ordem do documento), tema da
 * legenda e a área/disciplina que o documento indica (casadas com a taxonomia existente).
 */
export function guideHints(drafts: Record<string, DraftItem>, blocks: Block[], guide: DocumentGuide | undefined, taxonomy: string): { resolved: { area?: string; disciplina?: string }; byId: Record<string, GuideHint> } {
  if (!guide) return { resolved: {}, byId: {} }
  const resolved = resolveGuideTaxonomy(guide, parseTaxonomyLines(taxonomy))
  const blockById = Object.fromEntries(blocks.map((b) => [b.id, b]))
  const list = Object.values(drafts)
  const numbers = numberQuestions(list.map((d) => blockById[d.blockId]?.seg.sourceLabel ?? d.rotulo))
  return { resolved, byId: Object.fromEntries(list.map((d, i) => [d.id, { n: numbers[i], topic: topicForQuestion(guide, numbers[i]) }])) }
}

/**
 * Classificação SEM IA pelo guia do documento: questão cujo número está na legenda de temas, com área e
 * disciplina reconhecidas, vira um grupo "Área › Disciplina › Tema da legenda" (na ordem do documento).
 * `rest` = questões que ainda precisam da IA.
 */
export function classifyByGuide(drafts: Record<string, DraftItem>, blocks: Block[], guide: DocumentGuide | undefined, taxonomy: string): { grupos: Grupo[]; rest: string[] } {
  const { resolved, byId } = guideHints(drafts, blocks, guide, taxonomy)
  const grupos = new Map<string, Grupo>()
  const rest: string[] = []
  for (const id of Object.keys(drafts)) {
    const topic = byId[id]?.topic
    if (!resolved.area || !resolved.disciplina || !topic) {
      rest.push(id)
      continue
    }
    const g = grupos.get(topic.source) ?? {
      area: resolved.area,
      disciplina: resolved.disciplina,
      assunto: topic.assunto,
      descricao: `Tema indicado pelo próprio documento na lista de questões (questões ${topic.source}).`,
      questoes: [],
    }
    g.questoes.push({ id })
    grupos.set(topic.source, g)
  }
  return { grupos: [...grupos.values()], rest }
}

/**
 * Estrutura UM lote (requisição já reservada). IA indisponível → fallback determinístico do lote, sem perder
 * questão. As tentativas entram em `aiLog` via onAttempt (compartilhado entre lotes em paralelo).
 */
async function structureBatch(
  batchIds: string[],
  byId: Record<string, Block>,
  nonce: string,
  ctx: ImportCtx,
  aiLog: AttemptLog[],
): Promise<{ drafts: Record<string, DraftItem>; warnings: string[] }> {
  const sourceById = Object.fromEntries(batchIds.map((id) => [id, byId[id].text]))
  const drafts: Record<string, DraftItem> = {}
  try {
    const prompt = wrapUntrusted(batchIds.map((id) => `### bloco_id: ${id} (pág. ${byId[id].seg.page ?? '?'})\n${byId[id].text}`).join('\n\n'), nonce)
    const r = await callStructured({
      task: 'structure',
      userId: ctx.userId,
      deadline: ctx.deadline,
      schema: structuredBatchSchema,
      system: STRUCTURE_SYSTEM(nonce),
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
      // só blocos DESTE lote (um id de outro lote sobrescreveria o resultado dele)
      if (!b || !(q.bloco_id in sourceById)) continue
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
        perguntas: q.perguntas.map((p) => ({ ...p, rotulo: cleanItemLabel(p.rotulo) })),
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
    return { drafts, warnings: r.value.alertas }
  } catch (err) {
    if (!(err instanceof AiUnavailableError) || err instanceof AiQuotaExhaustedError) throw err
    for (const id of batchIds) drafts[id] = draftFromSegment(byId[id], ['Processado sem IA — revise'])
    return { drafts, warnings: ['IA indisponível para um lote; itens marcados para revisão.'] }
  }
}

/**
 * Sem IA: se o documento indica área e disciplina, as questões vão para lá — no tema da legenda, ou em
 * "Geral" (o usuário ajusta o assunto). Sem área/disciplina indicadas, ficam em "Revisar categoria".
 */
export function guideFallbackGroups(batchIds: string[], hints: ReturnType<typeof guideHints>): Grupo[] {
  const { area, disciplina } = hints.resolved
  if (!area || !disciplina) return []
  const grupos: Grupo[] = []
  for (const id of batchIds) {
    const assunto = hints.byId[id]?.topic?.assunto ?? GUIDE_FALLBACK_TOPIC
    let g = grupos.find((x) => x.assunto === assunto)
    if (!g) {
      const descricao = assunto === GUIDE_FALLBACK_TOPIC ? 'Área e disciplina indicadas pelo documento; assunto não identificado sem IA — ajuste se quiser.' : 'Tema indicado pelo próprio documento.'
      grupos.push((g = { area, disciplina, assunto, descricao, questoes: [] }))
    }
    g.questoes.push({ id })
  }
  return grupos
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
    // Capa / instruções / legenda de temas antes da 1ª questão: guia da classificação, não questão
    const guide = detectDocumentGuide(s.rawPages)
    const blocks: Block[] = segmentQuestions(fullText, { skipPreamble: guide.hasFrontMatter }).map((seg, i) => {
      const text = blockText(seg)
      return { id: `b${i + 1}`, text, seg, risk: inspectText(text).risk }
    })
    const pendingBatches = chunkBy(blocks, (b) => b.text.length, MAX_BATCH_CHARS, MAX_BATCH_ITEMS).map((batch) => batch.map((b) => b.id))
    const found = [guide.topics.length && `lista de temas por questão (${guide.topics.length} temas)`, guide.instructions && 'instruções do material'].filter(Boolean)
    const warnings = found.length ? [...s.warnings, `Guia do documento encontrado${guide.page ? ` na pág. ${guide.page}` : ''}: ${found.join(' e ')} — usado na classificação.`] : s.warnings
    return { blocks, guide, pendingBatches, warnings }
  })
  .addEdge('segment', 'structure')

  /* 4. Estruturação com IA (grounding obrigatório) + fallback determinístico — até STRUCTURE_PARALLEL lotes por passo */
  .addNode('structure', async (s, ctx) => {
    const batches: string[][] = []
    for (const batch of s.pendingBatches.slice(0, STRUCTURE_PARALLEL)) {
      // Cota esgotada no 1º lote interrompe o passo (429 → checkpoint); nos seguintes, só processa os já reservados.
      try {
        await ctx.reserveAiRequest()
      } catch (err) {
        if (!batches.length) throw err
        break
      }
      batches.push(batch)
    }
    const byId = Object.fromEntries(s.blocks.map((b) => [b.id, b]))
    const aiLog = [...s.aiLog]
    const results = await Promise.all(batches.map((ids) => structureBatch(ids, byId, s.nonce, ctx, aiLog)))
    // Mescla na ordem dos lotes: a ordem das chaves de `drafts` é a ordem do documento (classificação e revisão).
    const drafts = { ...s.drafts }
    for (const r of results) Object.assign(drafts, r.drafts)
    return { drafts, aiLog, pendingBatches: s.pendingBatches.slice(batches.length), warnings: [...s.warnings, ...results.flatMap((r) => r.warnings)] }
  })
  .addConditionalEdges('structure', (s) => (s.pendingBatches.length ? 'structure' : 'classify'))

  /* 5. Categorização em Área › Disciplina › Assunto + descrição dos cards (loop por lote de questões) */
  .addNode('classify', async (s, ctx) => {
    // 1ª passada (jobs novos): o que o GUIA DO DOCUMENTO resolve vai direto para o card, sem gastar requisição
    if (!s.pendingClassify && s.guide) {
      const { grupos, rest } = classifyByGuide(s.drafts, s.blocks, s.guide, ctx.taxonomy)
      if (grupos.length) {
        const total = Object.keys(s.drafts).length
        const merged = mergeClassification(s.cards, s.drafts, Object.keys(s.drafts).filter((id) => !rest.includes(id)), grupos)
        return {
          ...merged,
          pendingClassify: planClassifyBatches(Object.fromEntries(rest.map((id) => [id, s.drafts[id]]))),
          classifyRetried: false,
          warnings: [...s.warnings, `${total - rest.length} de ${total} questões classificadas pela lista de temas do próprio documento.`],
        }
      }
    }
    // Jobs que chegam aqui pela 1ª vez (ou de antes dos lotes) ainda não têm a fila.
    const [batchIds = [], ...rest] = s.pendingClassify ?? planClassifyBatches(s.drafts)
    const batch = batchIds.map((id) => s.drafts[id]).filter(Boolean)
    if (!batch.length) return nextClassifyQueue(rest, s.cards, s.classifyRetried)
    const hints = guideHints(s.drafts, s.blocks, s.guide, ctx.taxonomy)
    const sectionOf = Object.fromEntries(s.blocks.map((b) => [b.id, b.seg.section]))
    try {
      await ctx.reserveAiRequest()
      const guideText = s.guide ? guideForPrompt(s.guide, hints.resolved) : ''
      const questions = batch.map((d) => {
        const h = hints.byId[d.id]
        const pistas = [h?.topic && `tema indicado pelo documento: ${h.topic.assunto}`, sectionOf[d.blockId] && `seção: ${sectionOf[d.blockId]}`].filter(Boolean).join(' · ')
        return `id: ${d.id}${pistas ? ` (${pistas})` : ''}\n${d.enunciado.slice(0, 400)}\n${d.perguntas.map((p) => p.texto).join(' | ').slice(0, 200)}`
      })
      const r = await callStructured({
        task: 'classify',
        userId: ctx.userId,
        deadline: ctx.deadline,
        schema: classificationSchema,
        system: CLASSIFY_SYSTEM(s.nonce, ctx.taxonomy, s.cards.filter((c) => c.assunto !== UNCLASSIFIED_TOPIC).map((c) => `${c.area} › ${c.disciplina} › ${c.assunto}`)),
        prompt: wrapUntrusted(`${guideText ? `GUIA DO DOCUMENTO:\n${guideText}\n===\n` : ''}${questions.join('\n---\n')}`, s.nonce),
      })
      const merged = mergeClassification(s.cards, s.drafts, batchIds, r.value.grupos)
      return { ...merged, ...nextClassifyQueue(rest, merged.cards, s.classifyRetried) }
    } catch (err) {
      if (!(err instanceof AiUnavailableError) || err instanceof AiQuotaExhaustedError) throw err
      const merged = mergeClassification(s.cards, s.drafts, batchIds, guideFallbackGroups(batchIds, hints), 'Classificação automática indisponível — organize manualmente.')
      return { ...merged, ...nextClassifyQueue(rest, merged.cards, s.classifyRetried) }
    }
  })
  .addConditionalEdges('classify', (s) => (s.pendingClassify?.length ? 'classify' : s.options.generateDistractors ? 'plan-distractors' : 'validate'))

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
      // Cota do dia acabou: para de gerar (as perguntas restantes seguem discursivas) e avisa na revisão.
      if (err instanceof AiQuotaExhaustedError) {
        const left = [keys, ...rest].reduce((a, b) => a + b.length, 0)
        return { drafts, pendingDistractors: [], warnings: [...s.warnings, `A cota diária de IA acabou: ${left} pergunta(s) ficaram sem alternativas. Gere depois na revisão ou use o seu agente de IA.`] }
      }
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
