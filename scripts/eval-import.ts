/**
 * AVALIAÇÃO DO IMPORTADOR contra o gabarito de referência.
 *
 *   npm run eval:import                 → segmentador determinístico (o que roda sem IA / fallback)
 *   npm run eval:import -- --ai         → pipeline completo com OpenRouter (precisa OPENROUTER_API_KEY)
 *   npm run eval:import -- --ai --batches 3   → só os 3 primeiros lotes por PDF (economiza cota)
 *   npm run eval:import -- --vision     → + etapa de VISÃO (recortes das imagens → modelo de visão gratuito)
 *                                         antes da segmentação; compara sem × com visão (1 chamada a cada 3 imagens)
 *   npm run eval:import -- --vision --reuse   → reaproveita transcrições/predições salvas (sem novas chamadas)
 *   npm run eval:import -- --ai --vision --batches 12 --pdf u2
 *
 * Mede, por PDF: detecção de questões (precisão/recall), separação enunciado × perguntas,
 * nº de perguntas por questão, texto das perguntas e respostas anexadas à pergunta certa — e, para as
 * questões que DEPENDEM DE IMAGEM (metadado "Imagem" do gabarito): detecção e conteúdo da imagem
 * recuperado (valores dos quadros POP-Q ponto a ponto; texto de fotos/prints).
 * Saída: resumo no console + samples/private/eval/relatorio-*.md (detalhado, privado).
 * Metodologia e resultados: docs/10-avaliacao-importador.md
 */
import './load-env'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fullTextWithImages, type ImageNote } from '../shared/page-images'
import { segmentQuestions } from '../shared/segmenter'
import type { PageImageState } from '../server/ai/pipelines/import-graph'
import { parseGabarito, type GoldQuestion } from './gabarito'
import { openPdfWithImages } from './pdf-images-node'

interface PredItem {
  label?: string
  prompt: string
  answer?: string
}
interface PredQuestion {
  stem: string
  items: PredItem[]
  page?: number
}

const ALL_DOCS = [
  { id: 'u2', pdf: 'Unidade II.pdf', gold: 'samples/private/gabarito-unidade-ii.md' },
  { id: 'u3', pdf: 'III UNIDADE.pdf', gold: 'samples/private/gabarito-iii-unidade.md' },
]

const args = process.argv.slice(2)
const USE_AI = args.includes('--ai')
const VISION = args.includes('--vision')
const BATCHES = Number(args[args.indexOf('--batches') + 1]) || (USE_AI ? 3 : Infinity)
/** --pdf u2|u3: avalia só um dos PDFs */
const ONLY = args.includes('--pdf') ? args[args.indexOf('--pdf') + 1] : null
/** --reuse: recalcula as métricas com as predições de IA / transcrições salvas, sem novas chamadas */
const REUSE = args.includes('--reuse')
/** Diagnóstico do modo IA (preenchido por predictWithAi / runVision). */
const aiAttempts: Record<string, unknown>[] = []
const visionAttempts: Record<string, unknown>[] = []
let aiOrigin: { ai: number; fallback: number } | null = null

/* ----------------------------- similaridade ----------------------------- */
const fold = (s: string) => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '')
const tokens = (s: string) =>
  fold(s)
    .replace(/\[imagem[^\]]*\]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
function diceOf(A: Set<string>, B: Set<string>): number {
  if (!A.size && !B.size) return 1
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return (2 * inter) / (A.size + B.size)
}
const dice = (a: string, b: string) => diceOf(new Set(tokens(a)), new Set(tokens(b)))
/** Fração das palavras de `part` presentes em `whole` (cobertura). */
function coverage(part: string, whole: string): number {
  const P = tokens(part)
  if (!P.length) return 1
  const W = new Set(tokens(whole))
  return P.filter((w) => W.has(w)).length / P.length
}
/**
 * Tokens que MANTÊM o conteúdo das imagens (só tiram os marcadores "[Imagem p. N" / "— fim]"):
 * números com sinal/decimais e siglas de 2 letras (Aa, Bp…) contam. Usado só para casar questões que
 * dependem de imagem — as de texto continuam com `tokens` (métricas de texto inalteradas).
 */
const imgTokens = (s: string) =>
  fold(s)
    .replace(/\[imagem p\.\s*\d+\s*(:|— texto da imagem:\]|— fim\]|\])/g, ' ')
    .replace(/[−–]/g, '-')
    .match(/[+-]?\d+(?:[.,]\d+)?|[a-z]{2,}/g) ?? []
const diceImg = (a: string, b: string) => diceOf(new Set(imgTokens(a)), new Set(imgTokens(b)))
const f1 = (v: number) => `${(v * 100).toFixed(1)}%`

/* ----------------------------- POP-Q ----------------------------- */
const POPQ_ALIAS: Record<string, string> = { gh: 'hg', pb: 'cp', tvl: 'cvt' }
const POPQ_POINTS = ['aa', 'ba', 'c', 'hg', 'cp', 'cvt', 'ap', 'bp', 'd']
const normVal = (v: string) => {
  const s = v.replace(/\s+/g, '').replace(/[−–]/g, '-').replace('.', ',')
  if (/^(—|-{2,3})$/.test(s)) return '—'
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? String(n).replace('.', ',') : s // "+2"→"2", "4,0"→"4", "-0"→"0"
}
/** Quadros POP-Q de um texto (um por "[Imagem p. N: POP-Q — …]" ou trecho após "POP-Q"). */
function popqSets(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const chunk of fold(text).split(/pop-?q/).slice(1)) {
    const body = chunk.split(/\]|\n\n/)[0]
    const set: Record<string, string> = {}
    for (const m of body.matchAll(/(?:^|[^a-z])(aa|ba|c|hg|gh|cp|pb|cvt|tvl|ap|bp|d)\s*[:=]?\s*([+\-−–]?\s*\d+(?:[.,]\d+)?|—|-{2,3})/g)) {
      const k = POPQ_ALIAS[m[1]] ?? m[1]
      if (!(k in set)) set[k] = normVal(m[2])
    }
    if (Object.keys(set).length >= 5) out.push(set)
  }
  return out
}

/* ----------------------------- predição ----------------------------- */
function predictDeterministic(full: string): PredQuestion[] {
  return segmentQuestions(full).map((q) => ({ stem: q.stem, page: q.page, items: q.items }))
}

async function predictWithAi(pages: { page: number; text: string }[], images: Record<string, PageImageState>): Promise<PredQuestion[]> {
  const { importGraph } = await import('../server/ai/pipelines/import-graph')
  const { END } = await import('../server/ai/graph')
  let state = importGraph.initial({
    nonce: Math.random().toString(36).slice(2, 10),
    options: { generateDistractors: false },
    rawPages: pages,
    images,
    blocks: [],
    pendingBatches: [],
    pendingDistractors: [],
    drafts: {},
    cards: [],
    warnings: [],
    aiLog: [],
    guardRisk: 'baixo',
  })
  const ctx: { userId: string; taxonomy: string; reserveAiRequest: () => Promise<void>; deadline?: number } = {
    userId: 'eval',
    taxonomy: 'Medicina > Ginecologia\nMedicina > Mastologia',
    reserveAiRequest: async () => {},
  }
  let batches = 0
  while (state.cursor !== END) {
    if (state.cursor === 'structure') {
      if (batches >= BATCHES) break
      batches++
      console.log(`   lote ${batches} (${state.pendingBatches[0]?.length ?? 0} blocos)…`)
    }
    const before = state.aiLog.length
    const t0 = Date.now()
    ctx.deadline = t0 + 240_000 // mesmo prazo por passo da produção (POST /imports/:id/run)
    state = await importGraph.step(state, ctx)
    if (state.history.at(-1)?.node === 'structure') {
      // Diagnóstico: cada tentativa do lote (modelo, resultado, motivo da falha)
      for (const a of state.aiLog.slice(before)) {
        console.log(`      ${a.ok ? '✓' : '✗'} ${a.model} ${a.ok ? '' : `[${a.errorKind}${a.status ? ` HTTP ${a.status}` : ''}]`} ${a.latencyMs} ms${a.error ? ` — ${a.error.slice(0, 140)}` : ''}`)
        aiAttempts.push({ batch: batches, ...a })
      }
      const fellBack = !state.aiLog.slice(before).some((a) => a.ok)
      console.log(`      → ${fellBack ? 'FALLBACK determinístico' : 'estruturado pela IA'} em ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    }
    if (state.cursor === 'classify') break // avaliação de estrutura: classificação fica de fora
  }
  const ok = state.aiLog.filter((l) => l.ok).length
  const drafts = Object.values(state.drafts)
  const viaFallback = drafts.filter((d) => d.flags.some((f) => /sem IA|não devolveu/i.test(f))).length
  console.log(`   chamadas: ${state.aiLog.length} (${ok} ok) · questões pela IA: ${drafts.length - viaFallback} · pelo fallback: ${viaFallback} · avisos: ${state.warnings.length}`)
  aiOrigin = { ai: drafts.length - viaFallback, fallback: viaFallback }
  return drafts.map((d) => ({
    stem: d.enunciado,
    page: d.pagina ?? undefined,
    items: d.perguntas.map((p) => ({ label: p.rotulo ?? undefined, prompt: p.texto, answer: p.resposta_esperada ?? undefined })),
  }))
}

type OpenPdf = Awaited<ReturnType<typeof openPdfWithImages>>

/**
 * Etapa de visão pelo PRÓPRIO grafo de produção (nós guard → vision), com os recortes renderizados
 * em Node no lugar dos que o navegador enviaria. Devolve o estado das imagens (transcrições).
 */
async function runVision(pdf: OpenPdf): Promise<Record<string, PageImageState>> {
  const { importGraph } = await import('../server/ai/pipelines/import-graph')
  const images: Record<string, PageImageState> = {}
  for (const p of pdf.pages) for (const im of p.images) images[im.id] = { page: p.page, status: 'pendente' }
  let state = importGraph.initial({
    nonce: Math.random().toString(36).slice(2, 10),
    options: { generateDistractors: false },
    rawPages: pdf.pages.map((p) => ({ page: p.page, text: p.text })),
    images,
    blocks: [],
    pendingBatches: [],
    pendingDistractors: [],
    drafts: {},
    cards: [],
    warnings: [],
    aiLog: [],
    guardRisk: 'baixo',
  })
  let bytes = 0
  const ctx = {
    userId: 'eval',
    taxonomy: '',
    deadline: 0,
    reserveAiRequest: async () => {},
    loadImages: async (ids: { id: string; page: number }[]) =>
      Promise.all(
        ids.map(async ({ id, page }) => {
          const j = await pdf.renderImage(page, id)
          bytes += j.bytes
          return { id, page, base64: j.base64, mediaType: 'image/jpeg' as const }
        }),
      ),
  }
  let batch = 0
  const started = Date.now()
  while (state.cursor === 'guard' || state.cursor === 'vision') {
    const node = state.cursor
    const before = state.aiLog.length
    const t0 = Date.now()
    ctx.deadline = t0 + 240_000
    state = await importGraph.step(state, ctx)
    if (node !== 'vision' || state.aiLog.length === before) continue
    batch++
    for (const a of state.aiLog.slice(before)) visionAttempts.push({ batch, ...a })
    const done = Object.values(state.images ?? {}).filter((v) => v.status !== 'pendente').length
    const last = state.aiLog.slice(before)
    console.log(
      `   visão lote ${batch}: ${last.map((a) => `${a.ok ? '✓' : '✗'} ${a.model.split('/')[1]}${a.ok ? '' : ` [${a.errorKind}${a.status ? ` ${a.status}` : ''}]`}`).join(' ')} · ${((Date.now() - t0) / 1000).toFixed(0)} s · ${done}/${Object.keys(images).length}`,
    )
  }
  const all = Object.values(state.images ?? {})
  console.log(
    `   visão: ${all.filter((v) => v.status === 'ok').length}/${all.length} imagens transcritas em ${batch} lote(s), ${((Date.now() - started) / 1000).toFixed(0)} s, ${Math.round(bytes / 1024)} KB de JPEG · tipos: ${JSON.stringify(Object.fromEntries(['texto', 'pop_q', 'tabela', 'figura', 'decorativa'].map((k) => [k, all.filter((v) => v.kind === k).length])))}`,
  )
  return state.images ?? {}
}

/* ----------------------------- comparação ----------------------------- */
interface Match {
  g: GoldQuestion
  p: PredQuestion
  stemSim: number
}

const qText = (q: { stem: string; items: { prompt: string }[] }) => `${q.stem} ${q.items.map((i) => i.prompt).join(' ')}`
const predFull = (p: PredQuestion) => `${p.stem}\n${p.items.map((i) => `${i.prompt}\n${i.answer ?? ''}`).join('\n')}`

function matchQuestions(gold: GoldQuestion[], pred: PredQuestion[]): { matches: Match[]; unmatchedGold: GoldQuestion[]; unmatchedPred: PredQuestion[] } {
  const pairs: { gi: number; pi: number; score: number; sim: number }[] = []
  gold.forEach((g, gi) => {
    const gText = qText(g)
    pred.forEach((p, pi) => {
      const pText = qText(p)
      // Questões que dependem de imagem também podem casar pelo conteúdo transcrito (ex.: enunciado só com quadro POP-Q)
      const sim = Math.max(dice(gText, pText), g.image ? diceImg(gText, pText) : 0)
      const near = p.page != null && Math.abs(p.page - g.page) <= 2 ? 0.1 : 0
      if (sim >= 0.3) pairs.push({ gi, pi, score: sim + near, sim })
    })
  })
  pairs.sort((a, b) => b.score - a.score)
  const usedG = new Set<number>()
  const usedP = new Set<number>()
  const matches: Match[] = []
  for (const pr of pairs) {
    if (usedG.has(pr.gi) || usedP.has(pr.pi) || pr.sim < 0.45) continue
    usedG.add(pr.gi)
    usedP.add(pr.pi)
    matches.push({ g: gold[pr.gi], p: pred[pr.pi], stemSim: dice(gold[pr.gi].stem, pred[pr.pi].stem) })
  }
  return { matches, unmatchedGold: gold.filter((_, i) => !usedG.has(i)), unmatchedPred: pred.filter((_, i) => !usedP.has(i)) }
}

function alignItems(m: Match) {
  const g = m.g.items
  const p = m.p.items
  return g.map((gi, i) => {
    const byLabel = gi.label ? p.find((x) => x.label?.toLowerCase() === gi.label) : undefined
    const pi = byLabel ?? (g.length === p.length ? p[i] : undefined)
    const promptOk = !pi ? false : !gi.prompt ? !pi.prompt || coverage(pi.prompt, `${m.g.stem} ${gi.prompt}`) > 0.8 : dice(gi.prompt, pi.prompt) >= 0.6
    let answerScore = 0
    if (pi && gi.expectedAnswer && pi.answer) {
      // F1 de cobertura: pega a resposta certa SEM engolir a próxima pergunta
      const rec = coverage(gi.expectedAnswer, pi.answer)
      const prec = coverage(pi.answer, gi.expectedAnswer)
      answerScore = rec + prec ? (2 * rec * prec) / (rec + prec) : 0
    }
    return { gi, pi, promptOk, answerOk: !!gi.expectedAnswer && answerScore >= 0.6, answerScore }
  })
}

interface ImageEval {
  g: GoldQuestion
  matched: boolean
  /** POP-Q: pontos certos / pontos do gabarito (null = questão sem quadro POP-Q). */
  popq: { ok: number; total: number } | null
  /** Conteúdo da imagem recuperado (POP-Q 100% certo; demais: texto da questão presente e transcrição na questão). */
  contentOk: boolean
}

/** Avalia um conjunto de predições contra o gabarito do trecho (texto + imagem). */
function evaluate(goldScope: GoldQuestion[], pred: PredQuestion[], textual: (g: GoldQuestion) => boolean) {
  const goldText = goldScope.filter(textual)
  const { matches, unmatchedGold, unmatchedPred } = matchQuestions(goldScope, pred)
  const textMatches = matches.filter((m) => textual(m.g))
  const aligned = textMatches.map((m) => ({ m, items: alignItems(m) }))
  const goldItems = aligned.flatMap((a) => a.items)
  const goldItemsWithAnswer = goldItems.filter((x) => x.gi.expectedAnswer)
  const sameCount = aligned.filter((a) => a.m.g.items.length === a.m.p.items.length).length

  // Questões que dependem de imagem (metadado "Imagem" do gabarito)
  const byGold = new Map(matches.map((m) => [m.g.id, m]))
  const images: ImageEval[] = goldScope
    .filter((g) => g.image)
    .map((g) => {
      const m = byGold.get(g.id)
      const goldSets = popqSets(qText(g))
      let popq: ImageEval['popq'] = null
      if (goldSets.length) {
        const predSets = m ? popqSets(predFull(m.p)) : []
        let ok = 0
        let total = 0
        for (const gs of goldSets) {
          const keys = POPQ_POINTS.filter((k) => k in gs)
          total += keys.length
          ok += Math.max(0, ...predSets.map((ps) => keys.filter((k) => ps[k] === gs[k]).length))
        }
        popq = { ok, total }
      }
      const contentOk = !!m && (popq ? popq.ok === popq.total : /\[Imagem p\. \d+(:| — texto)/.test(predFull(m.p)) && coverage(qText(g), predFull(m.p)) >= 0.6)
      return { g, matched: !!m, popq, contentOk }
    })
  const popqQs = images.filter((x) => x.popq)
  const row = {
    goldQuestions: goldScope.length,
    goldTextual: goldText.length,
    predicted: pred.length,
    matched: matches.length,
    recallTextual: textMatches.length / Math.max(1, goldText.length),
    precision: matches.length / Math.max(1, pred.length),
    sameItemCount: sameCount / Math.max(1, aligned.length),
    stemSimilarity: textMatches.reduce((s, m) => s + m.stemSim, 0) / Math.max(1, textMatches.length),
    promptOk: goldItems.filter((x) => x.promptOk).length / Math.max(1, goldItems.length),
    answerOk: goldItemsWithAnswer.filter((x) => x.answerOk).length / Math.max(1, goldItemsWithAnswer.length),
    goldImage: images.length,
    imageDetected: images.filter((x) => x.matched).length / Math.max(1, images.length),
    imageContentOk: images.filter((x) => x.contentOk).length / Math.max(1, images.length),
    goldPopq: popqQs.length,
    popqQuestionsOk: popqQs.filter((x) => x.popq!.ok === x.popq!.total).length / Math.max(1, popqQs.length),
    popqPointsOk: popqQs.reduce((a, x) => a + x.popq!.ok, 0) / Math.max(1, popqQs.reduce((a, x) => a + x.popq!.total, 0)),
  }
  return { row, matches, unmatchedGold, unmatchedPred, aligned, goldText, images }
}

function printRow(label: string, r: ReturnType<typeof evaluate>['row']) {
  console.log(`   [${label}] questões detectadas: ${r.predicted} · casadas: ${r.matched}`)
  console.log(`      TEXTO  recall: ${f1(r.recallTextual)} (${r.goldTextual}) · precisão: ${f1(r.precision)} · nº de perguntas: ${f1(r.sameItemCount)} · enunciado: ${f1(r.stemSimilarity)} · pergunta: ${f1(r.promptOk)} · resposta: ${f1(r.answerOk)}`)
  console.log(`      IMAGEM detectadas: ${f1(r.imageDetected)} (${r.goldImage}) · conteúdo da imagem recuperado: ${f1(r.imageContentOk)} · POP-Q 100% certos: ${f1(r.popqQuestionsOk)} (${r.goldPopq}) · pontos POP-Q certos: ${f1(r.popqPointsOk)}`)
}

/* ----------------------------- execução ----------------------------- */
const mode = `${USE_AI ? `pipeline com IA (até ${BATCHES} lotes/PDF)` : 'segmentador determinístico'}${VISION ? ' + visão' : ''}`
const report: string[] = [`# Relatório de avaliação do importador — ${new Date().toISOString()}`, '', `Modo: ${mode}`, '']
const summary: Record<string, unknown>[] = []

const DOCS = ALL_DOCS.filter((d) => !ONLY || d.id === ONLY)
for (const d of DOCS) {
  aiAttempts.length = 0
  visionAttempts.length = 0
  aiOrigin = null
  if (!existsSync(d.gold) || !existsSync(d.pdf)) {
    console.log(`⚠ ${d.pdf}: gabarito ou PDF ausente — rode "npm run gabarito:build" e mantenha o PDF na raiz.`)
    continue
  }
  console.log(`\n▶ ${d.pdf}`)
  const gold = parseGabarito(readFileSync(d.gold, 'utf8'), d.pdf)
  const pdf = await openPdfWithImages(d.pdf)
  const plainPages = pdf.pages.map((p) => ({ page: p.page, text: p.plainText }))
  const full = plainPages.map((p) => `\n[[página ${p.page}]]\n${p.text}`).join('\n')

  // "Textual" = o conteúdo da questão está na camada de texto do PDF. Questões cujo enunciado/dados
  // vêm de foto, print ou esquema (metadado "Imagem" do gabarito) só são recuperáveis com visão/OCR.
  const textual = (g: GoldQuestion) => {
    const t = qText(g)
    return !g.image && tokens(t).length >= 4 && coverage(t, full) >= 0.5
  }

  // Visão: transcrições das imagens (cache em samples/private/eval/visao-*.json)
  let notes: Record<string, PageImageState> = {}
  const visionCache = `samples/private/eval/visao-${d.id}.json`
  if (VISION) {
    const total = pdf.pages.reduce((a, p) => a + p.images.length, 0)
    if (REUSE && existsSync(visionCache)) {
      notes = JSON.parse(readFileSync(visionCache, 'utf8')) as Record<string, PageImageState>
      console.log(`   (transcrições reaproveitadas de ${visionCache})`)
    } else {
      console.log(`   visão: ${total} imagem(ns) úteis em ${pdf.pages.filter((p) => p.images.length).length} páginas`)
      notes = await runVision(pdf)
      mkdirSync('samples/private/eval', { recursive: true })
      writeFileSync(visionCache, JSON.stringify(notes, null, 1))
    }
  }
  const visionPages = pdf.pages.map((p) => ({ page: p.page, text: p.text })) // com [[imagem pN-k]]
  const visionFull = fullTextWithImages(visionPages, notes as Record<string, ImageNote>)

  const cacheFile = `samples/private/eval/pred-ia${VISION ? '-visao' : ''}-${d.id}.json`
  let pred: PredQuestion[]
  if (USE_AI && REUSE && existsSync(cacheFile)) {
    pred = JSON.parse(readFileSync(cacheFile, 'utf8')) as PredQuestion[]
    console.log(`   (predições reaproveitadas de ${cacheFile})`)
  } else if (USE_AI) {
    pred = await predictWithAi(VISION ? visionPages : plainPages, VISION ? notes : {})
    mkdirSync('samples/private/eval', { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(pred))
  } else pred = predictDeterministic(VISION ? visionFull : full)

  // No modo IA parcial, avalia só o trecho processado. Questões da ÚLTIMA página processada só contam
  // se foram casadas — as demais podem estar em blocos que nem foram enviados à IA.
  const maxPage = USE_AI && Number.isFinite(BATCHES) ? Math.max(...pred.map((p) => p.page ?? 0)) : Infinity
  const candidates = gold.filter((g) => g.page <= maxPage)
  const matchedIds = new Set(matchQuestions(candidates, pred).matches.map((m) => m.g.id))
  const goldScope = Number.isFinite(maxPage) ? candidates.filter((g) => g.page < maxPage || matchedIds.has(g.id)) : candidates

  const ev = evaluate(goldScope, pred, textual)
  const label = `${USE_AI ? 'IA' : 'sem IA'}${VISION ? ' + visão' : ''}`
  console.log(`   questões no gabarito: ${goldScope.length} (${ev.goldText.length} com texto extraível; ${ev.images.length} dependem de imagem)`)
  printRow(label, ev.row)
  // (cast: aiOrigin é preenchido dentro de predictWithAi, o que o fluxo de tipos do TS não enxerga)
  const origin = aiOrigin as { ai: number; fallback: number } | null
  const visionStats = VISION
    ? {
        imagens: Object.keys(notes).length,
        imagensOk: Object.values(notes).filter((v) => v.status === 'ok').length,
        chamadasVisao: visionAttempts.length,
        chamadasVisaoOk: visionAttempts.filter((a) => a.ok).length,
        modelosVisao: [...new Set(Object.values(notes).map((v) => v.model).filter(Boolean))],
      }
    : {}
  summary.push({ pdf: d.pdf, modo: label, ...ev.row, ...visionStats, ...(origin ? { questoesPelaIA: origin.ai, questoesPeloFallback: origin.fallback, tentativas: aiAttempts.length, tentativasOk: aiAttempts.filter((a) => a.ok).length } : {}) })

  // Comparações justas no MESMO trecho/gabarito: determinístico sem visão (e com visão, se for o caso).
  const baselines: [string, string][] = []
  if (USE_AI || VISION) baselines.push(['sem IA, sem visão', full])
  if (USE_AI && VISION) baselines.push(['sem IA + visão', visionFull])
  for (const [bl, text] of baselines) {
    const det = predictDeterministic(text).filter((p) => (p.page ?? 0) <= maxPage)
    const r = evaluate(goldScope, det, textual).row
    printRow(bl, r)
    summary.push({ pdf: d.pdf, modo: `${bl} (mesmo trecho)`, ...r })
  }

  report.push(`## ${d.pdf}`, '', `| Métrica | ${label} |`, '|---|---|')
  for (const [k, v] of Object.entries(ev.row)) report.push(`| ${k} | ${typeof v === 'number' && v <= 1 && !Number.isInteger(v) ? f1(v) : v} |`)
  if (USE_AI) {
    report.push('', '### Tentativas de IA (lote · modelo · resultado)', '')
    for (const a of aiAttempts) report.push(`- lote ${a.batch} · ${a.model} · ${a.ok ? 'ok' : `${a.errorKind}${a.status ? ` HTTP ${a.status}` : ''}`} · ${a.latencyMs} ms${a.error ? ` — ${String(a.error).slice(0, 160)}` : ''}`)
  }
  if (visionAttempts.length) {
    report.push('', '### Tentativas de visão (lote · modelo · resultado)', '')
    for (const a of visionAttempts) report.push(`- lote ${a.batch} · ${a.model} · ${a.ok ? 'ok' : `${a.errorKind}${a.status ? ` HTTP ${a.status}` : ''}`} · ${a.latencyMs} ms${a.error ? ` — ${String(a.error).slice(0, 160)}` : ''}`)
  }
  if (VISION) {
    report.push('', '### Questões que dependem de imagem', '', '| Questão | Pág. | Detectada | POP-Q (pontos) | Conteúdo recuperado |', '|---|---|---|---|---|')
    for (const x of ev.images) report.push(`| ${x.g.id} · ${x.g.sourceLabel} | ${x.g.page} | ${x.matched ? 'sim' : 'não'} | ${x.popq ? `${x.popq.ok}/${x.popq.total}` : '—'} | ${x.contentOk ? 'sim' : 'não'} |`)
    report.push('', '### Transcrições da visão (id · tipo · modelo · início)', '')
    for (const [id, v] of Object.entries(notes)) report.push(`- ${id} · ${v.status} · ${v.kind ?? '—'} · ${v.model ?? '—'} — ${(v.text ?? '').slice(0, 160).replace(/\n/g, ' ⏎ ')}`)
  }
  report.push('', '### Questões do gabarito não encontradas (com texto)', '')
  for (const g of ev.unmatchedGold.filter(textual)) report.push(`- ${g.id} · ${g.sourceLabel} · p. ${g.page} — ${g.stem.slice(0, 120).replace(/\n/g, ' ')}…`)
  report.push('', '### Questões que dependem de imagem não encontradas', '')
  for (const x of ev.images.filter((y) => !y.matched)) report.push(`- ${x.g.id} · ${x.g.sourceLabel} · p. ${x.g.page}`)
  report.push('', '### Detecções sem correspondente no gabarito', '')
  for (const p of ev.unmatchedPred.slice(0, 40)) report.push(`- p. ${p.page ?? '?'} — ${p.stem.slice(0, 120).replace(/\n/g, ' ')}…`)
  report.push('', '### Divergências no nº de perguntas', '')
  for (const a of ev.aligned.filter((x) => x.m.g.items.length !== x.m.p.items.length)) report.push(`- ${a.m.g.id} (p. ${a.m.g.page}): gabarito ${a.m.g.items.length} × detectado ${a.m.p.items.length}`)
  report.push('', '### Respostas mal anexadas (amostra)', '')
  for (const a of ev.aligned) for (const x of a.items.filter((y) => y.gi.expectedAnswer && !y.answerOk).slice(0, 1)) report.push(`- ${a.m.g.id} pergunta ${x.gi.label ?? 'única'}: score ${(x.answerScore * 100).toFixed(0)}%`)
  report.push('')
  await pdf.destroy()
}

mkdirSync('samples/private/eval', { recursive: true })
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const tag = `${USE_AI ? 'ia' : 'deterministico'}${VISION ? '-visao' : ''}`
const file = `samples/private/eval/relatorio-${tag}-${stamp}.md`
writeFileSync(file, report.join('\n'))
writeFileSync(`samples/private/eval/ultimo-${tag}.json`, JSON.stringify(summary, null, 2))
console.log(`\nRelatório detalhado: ${file}`)
