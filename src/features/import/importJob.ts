import type { DocumentGuide } from '@shared/document-guide'
import type { ImportFile, ImportQuestion } from '@shared/schemas/import'
import { apiFetch } from '@/lib/api'
import type { PageImageCrop } from './pageImages'
import type { ExtractedPdf } from './pdfExtract'

/**
 * Importação de PDF pela API real (spec 002 T031 + T060), sem React — o hook `useImportJob` só guarda o estado.
 *
 *   1. POST /api/imports            texto das páginas com `[[imagem pN-k]]` + manifesto das imagens
 *   2. visão (opcional)             recortes JPEG renderizados no navegador → POST /:id/images em lotes ≤ 3;
 *                                   imagem que falha 1x volta sozinha no fim da fila; 429 → segue sem visão
 *   3. POST /:id/run em loop        até `revisao` (cada chamada ≤ ~240 s); enquanto roda, GET /:id a cada
 *                                   poucos segundos mostra o nó atual e os lotes que faltam
 *   4. GET /:id                     rascunhos + cards para a revisão
 *
 * O PDF nunca vai ao servidor. Contrato: specs/002-importacao-questoes/contracts/api-imports.md.
 */

/** Igual ao servidor (server/ai/pipelines/vision.ts): ≤ 3 imagens e ≤ 4 MB de base64 por requisição. */
export const VISION_BATCH = 3
export const MAX_BATCH_BASE64 = 4_000_000

export interface ServerDraft extends ImportQuestion {
  id: string
  blockId: string
  resumo?: string
  flags: string[]
}

export interface ServerCard {
  area: string
  disciplina: string
  assunto: string
  descricao: string
  questionIds: string[]
}

/** Resposta de GET /api/imports/:id. */
export interface ImportJobView {
  id: string
  status: 'processando' | 'revisao' | 'concluida' | 'falhou' | 'cancelada' | 'rascunho'
  node?: string
  progress: { blocks: number; pendingBatches: number; images?: Record<string, number> }
  warnings: string[]
  cards?: ServerCard[]
  drafts?: Record<string, ServerDraft>
  /** Guia do documento (instruções, temas por questão) lido no servidor — só em `revisao`. */
  guide?: DocumentGuide
  /** Job de agente externo: o JSON v2 validado (a revisão é montada no cliente). */
  payload?: ImportFile | null
  /** Revisão salva automaticamente (T042): cards + rascunhos já editados. */
  reviewDraft?: { cards: unknown[]; drafts: Record<string, unknown>; source: 'pdf_ia' | 'agente_externo' | 'manual'; fileName?: string } | null
}

export type JobPhase = 'criando' | 'recortando' | 'imagens' | 'processando' | 'revisao'

export interface JobProgress {
  phase: JobPhase
  jobId?: string
  /** Recortes renderizados no navegador. */
  crops?: { done: number; total: number }
  /** Lotes de imagens enviados à visão. */
  batches?: { done: number; total: number }
  images?: { ok: number; failed: number }
  /** Próximo nó do grafo no servidor (guard, vision, segment, structure, classify, …). */
  node?: string
  pendingBatches?: number
  blocks?: number
}

export class ImportJobError extends Error {
  readonly kind: 'cota' | 'rede' | 'servidor' | 'cancelado'
  readonly jobId?: string
  constructor(kind: ImportJobError['kind'], message: string, jobId?: string) {
    super(message)
    this.name = 'ImportJobError'
    this.kind = kind
    this.jobId = jobId
  }
}

export interface JobDeps {
  fetch?: typeof fetch
  /** Renderiza os recortes (padrão: pdf.js no navegador, carregado sob demanda). */
  renderImages?: (pdf: ExtractedPdf, onProgress: (done: number, total: number) => void) => Promise<PageImageCrop[]>
  /** Intervalo do GET de acompanhamento enquanto /run roda (0 = desligado). */
  pollMs?: number
  signal?: AbortSignal
  /** Proteção contra laço infinito de /run (cada um ≤ ~240 s). */
  maxRuns?: number
}

/* ------------------------------ lotes e payload ------------------------------ */

/** Lotes de até VISION_BATCH recortes e MAX_BATCH_BASE64 (o corpo da requisição fica < 4,5 MB). */
export function batchPageImages(crops: PageImageCrop[]): PageImageCrop[][] {
  const out: PageImageCrop[][] = []
  let cur: PageImageCrop[] = []
  let size = 0
  for (const c of crops) {
    if (cur.length && (cur.length >= VISION_BATCH || size + c.base64.length > MAX_BATCH_BASE64)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(c)
    size += c.base64.length
  }
  if (cur.length) out.push(cur)
  return out
}

/** Payload de criação do job (`POST /api/imports`, source "pdf_ia"): texto com marcadores + manifesto das imagens. */
export function pdfJobPayload(pdf: Pick<ExtractedPdf, 'fileName' | 'pages'>, opts: { generateDistractors?: boolean; vision?: boolean } = {}) {
  const vision = opts.vision !== false
  return {
    source: 'pdf_ia' as const,
    fileName: pdf.fileName.slice(0, 200),
    generateDistractors: !!opts.generateDistractors,
    pages: pdf.pages.map((p) => ({ page: p.page, text: (vision ? p.markedText : p.text).slice(0, 60_000) })),
    images: vision ? pdf.pages.flatMap((p) => p.imageRegions.map((r) => ({ id: r.id, page: p.page }))) : [],
  }
}

/* ------------------------------ HTTP ------------------------------ */

async function call<T>(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, jobId?: string): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new ImportJobError('cancelado', 'Acompanhamento interrompido — a importação continua salva.', jobId)
    throw new ImportJobError('rede', 'Sem conexão com o servidor. Seu progresso está salvo: tente continuar em instantes.', jobId)
  }
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = (isJson ? await res.json().catch(() => null) : null) as (T & { error?: string }) | null
  if (res.status === 429) throw new ImportJobError('cota', body?.error ?? 'Cota diária de IA atingida.', jobId)
  if (res.status === 413) throw new ImportJobError('servidor', 'O texto do PDF passou de 4,5 MB. Divida o PDF em partes.', jobId)
  if (!res.ok || !body) throw new ImportJobError('servidor', body?.error ?? (isJson ? `Erro ${res.status}` : 'API indisponível.'), jobId)
  return body
}

export const getImportJob = (jobId: string, fetchImpl: typeof fetch = apiFetch) => call<ImportJobView>(fetchImpl, `/api/imports/${encodeURIComponent(jobId)}`, {}, jobId)

/* ------------------------------ visão ------------------------------ */

export interface UploadResult {
  ok: number
  failed: number
  /** Parou por cota (HTTP 429): o restante segue como "[Imagem p. N]". */
  quotaExceeded: boolean
  warnings: string[]
}

/**
 * Envia os recortes em sequência para `POST /api/imports/:id/images` (antes do loop de `/run`).
 * Cada lote = 1 requisição de IA no orçamento diário. Imagem com `retry` (1ª falha) volta sozinha no fim.
 */
export async function uploadPageImages(jobId: string, crops: PageImageCrop[], onBatch?: (done: number, total: number, r: UploadResult) => void, deps: Pick<JobDeps, 'fetch' | 'signal'> = {}): Promise<UploadResult> {
  const fetchImpl = deps.fetch ?? apiFetch
  const batches = batchPageImages(crops)
  const res: UploadResult = { ok: 0, failed: 0, quotaExceeded: false, warnings: [] }
  for (let i = 0; i < batches.length; i++) {
    if (deps.signal?.aborted) throw new ImportJobError('cancelado', 'Envio das imagens interrompido.', jobId)
    try {
      const body = await call<{ results: { id: string; status: string; retry?: boolean }[]; warnings: string[] }>(
        fetchImpl,
        `/api/imports/${encodeURIComponent(jobId)}/images`,
        { method: 'POST', body: JSON.stringify({ images: batches[i].map((c) => ({ id: c.id, data: c.base64 })) }), signal: deps.signal },
        jobId,
      )
      for (const x of body.results) {
        const crop = batches[i].find((c) => c.id === x.id)
        if (x.status === 'ok') res.ok++
        else if (x.retry && crop) batches.push([crop]) // 2ª tentativa, sozinha, no fim da fila
        else res.failed++
      }
      res.warnings.push(...body.warnings)
    } catch (err) {
      if (!(err instanceof ImportJobError) || err.kind === 'cancelado') throw err
      if (err.kind === 'cota') {
        res.quotaExceeded = true
        res.failed += batches.slice(i).reduce((a, b) => a + b.length, 0)
        res.warnings.push(`Cota de IA atingida durante a visão: ${batches.slice(i).reduce((a, b) => a + b.length, 0)} imagem(ns) seguem sem transcrição.`)
        onBatch?.(batches.length, batches.length, res)
        break
      }
      res.failed += batches[i].length
      res.warnings.push(`Lote de imagens ${i + 1}: ${err.message}`)
    }
    onBatch?.(i + 1, batches.length, res)
  }
  return res
}

/* ------------------------------ fluxo completo ------------------------------ */

/** Loop de /run até `revisao` (retomável: o checkpoint fica no servidor). */
export async function driveImportJob(jobId: string, onProgress: (p: JobProgress) => void, deps: JobDeps = {}): Promise<ImportJobView> {
  const fetchImpl = deps.fetch ?? apiFetch
  const maxRuns = deps.maxRuns ?? 60
  onProgress({ phase: 'processando', jobId })
  for (let run = 0; run < maxRuns; run++) {
    if (deps.signal?.aborted) throw new ImportJobError('cancelado', 'Acompanhamento interrompido — a importação continua salva.', jobId)
    // Enquanto /run trabalha (até ~4 min), o GET mostra o nó atual a partir do checkpoint
    const poll =
      deps.pollMs && deps.pollMs > 0
        ? setInterval(() => {
            getImportJob(jobId, fetchImpl)
              .then((v) => v.status === 'processando' && onProgress({ phase: 'processando', jobId, node: v.node, pendingBatches: v.progress.pendingBatches, blocks: v.progress.blocks }))
              .catch(() => undefined)
          }, deps.pollMs)
        : null
    let res: { status: ImportJobView['status']; node?: string; progress?: { blocks: number; pendingBatches: number } }
    try {
      res = await call(fetchImpl, `/api/imports/${encodeURIComponent(jobId)}/run`, { method: 'POST', signal: deps.signal }, jobId)
    } finally {
      if (poll) clearInterval(poll)
    }
    if (res.status === 'revisao') break
    if (res.status !== 'processando') throw new ImportJobError('servidor', `Importação interrompida (status: ${res.status}).`, jobId)
    onProgress({ phase: 'processando', jobId, node: res.node, pendingBatches: res.progress?.pendingBatches, blocks: res.progress?.blocks })
    if (run === maxRuns - 1) throw new ImportJobError('servidor', 'A importação está demorando demais — tente continuar mais tarde.', jobId)
  }
  const view = await getImportJob(jobId, fetchImpl)
  if (view.status !== 'revisao') throw new ImportJobError('servidor', `Importação não terminou (status: ${view.status}).`, jobId)
  onProgress({ phase: 'revisao', jobId })
  return view
}

/**
 * PDF extraído → job no servidor → (visão) → pipeline → revisão.
 * `onJob` recebe o id assim que o job existe (para retomar depois de recarregar a página).
 */
export async function startPdfImport(
  pdf: ExtractedPdf,
  opts: { vision: boolean; generateDistractors?: boolean },
  onProgress: (p: JobProgress) => void,
  deps: JobDeps & { onJob?: (jobId: string) => void; onUpload?: (r: UploadResult) => void } = {},
): Promise<{ view: ImportJobView; upload: UploadResult | null }> {
  const fetchImpl = deps.fetch ?? apiFetch
  onProgress({ phase: 'criando' })
  const payload = pdfJobPayload(pdf, opts)
  const created = await call<{ id: string; status: string; images?: number }>(fetchImpl, '/api/imports', { method: 'POST', body: JSON.stringify(payload), signal: deps.signal })
  const jobId = created.id
  deps.onJob?.(jobId)

  let upload: UploadResult | null = null
  if (opts.vision && (created.images ?? 0) > 0) {
    onProgress({ phase: 'recortando', jobId, crops: { done: 0, total: created.images ?? 0 } })
    const render = deps.renderImages ?? (async (p, cb) => (await import('./pageImages')).renderPageImages(p, { onProgress: cb }))
    const crops = await render(pdf, (done, total) => onProgress({ phase: 'recortando', jobId, crops: { done, total } }))
    const total = batchPageImages(crops).length
    onProgress({ phase: 'imagens', jobId, batches: { done: 0, total }, images: { ok: 0, failed: 0 } })
    upload = await uploadPageImages(jobId, crops, (done, t, r) => onProgress({ phase: 'imagens', jobId, batches: { done, total: Math.max(t, total) }, images: { ok: r.ok, failed: r.failed } }), {
      fetch: fetchImpl,
      signal: deps.signal,
    })
    deps.onUpload?.(upload)
  }
  const view = await driveImportJob(jobId, onProgress, deps)
  return { view, upload }
}
