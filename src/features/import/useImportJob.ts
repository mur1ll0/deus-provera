import { useCallback, useEffect, useRef, useState } from 'react'
import { driveImportJob, ImportJobError, startPdfImport, type ImportJobView, type JobProgress, type UploadResult } from './importJob'
import type { ExtractedPdf } from './pdfExtract'

/**
 * Importação de PDF pela API real (spec 002 T031 + T060). Estado para a tela; o fluxo está em importJob.ts.
 * O id do job fica no navegador (localStorage) para retomar depois de recarregar/fechar a aba — o checkpoint
 * do pipeline está no servidor. Na retomada não há PDF: imagens ainda não enviadas viram "[Imagem p. N]".
 */

export interface PendingImport {
  id: string
  fileName: string
  at: number
}

export interface ImportJobState {
  status: 'idle' | 'running' | 'done' | 'error'
  jobId: string | null
  fileName: string | null
  progress: JobProgress | null
  upload: UploadResult | null
  view: ImportJobView | null
  error: { kind: ImportJobError['kind']; message: string } | null
}

const KEY = 'deus-provera:importacao-pendente'
const IDLE: ImportJobState = { status: 'idle', jobId: null, fileName: null, progress: null, upload: null, view: null, error: null }

function readPending(): PendingImport | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PendingImport | null
    // jobs com mais de 7 dias não valem a pena retomar
    return v?.id && Date.now() - v.at < 7 * 864e5 ? v : null
  } catch {
    return null
  }
}
function writePending(p: PendingImport | null) {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p))
    else localStorage.removeItem(KEY)
  } catch {
    /* modo privado / armazenamento bloqueado: só não dá para retomar depois */
  }
}

export function useImportJob() {
  const [state, setState] = useState<ImportJobState>(IDLE)
  const [pending, setPending] = useState<PendingImport | null>(() => readPending())
  const abort = useRef<AbortController | null>(null)

  // Saiu da tela: para de acompanhar (o servidor termina a chamada em curso; dá para retomar depois)
  useEffect(() => () => abort.current?.abort(), [])

  /** Executa o fluxo e devolve o resultado (ou null em erro/cancelamento — o erro fica em `state.error`). */
  const run = useCallback(async (fileName: string, work: (ctrl: AbortController, onProgress: (p: JobProgress) => void) => Promise<{ view: ImportJobView; upload: UploadResult | null }>): Promise<ImportJobView | null> => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    // só a execução mais recente mexe no estado (uma anterior cancelada não sobrescreve a nova)
    const current = () => abort.current === ctrl
    const onProgress = (p: JobProgress) => current() && !ctrl.signal.aborted && setState((s) => ({ ...s, jobId: p.jobId ?? s.jobId, progress: p }))
    setState({ ...IDLE, status: 'running', fileName })
    try {
      const { view, upload } = await work(ctrl, onProgress)
      writePending(null)
      setPending(null)
      if (!current()) return null
      setState((s) => ({ ...s, status: 'done', view, upload: upload ?? s.upload }))
      return view
    } catch (err) {
      if (!current()) return null
      const e = err instanceof ImportJobError ? err : new ImportJobError('servidor', (err as Error)?.message ?? 'Erro inesperado.')
      setState((s) => ({ ...s, status: 'error', jobId: e.jobId ?? s.jobId, error: { kind: e.kind, message: e.message } }))
      return null
    }
  }, [])

  /** Cria o job, envia os recortes das imagens (se `vision`) e acompanha o pipeline até a revisão. */
  const start = useCallback(
    (pdf: ExtractedPdf, opts: { vision: boolean; generateDistractors?: boolean }) =>
      run(pdf.fileName, (ctrl, onProgress) =>
        startPdfImport(pdf, opts, onProgress, {
          signal: ctrl.signal,
          pollMs: 4000,
          onJob: (id) => {
            const p = { id, fileName: pdf.fileName, at: Date.now() }
            writePending(p)
            setPending(p)
          },
          onUpload: (upload) => setState((s) => ({ ...s, upload })),
        }),
      ),
    [run],
  )

  /** Retoma um job em andamento (depois de erro de rede, cota ou de recarregar a página). */
  const resume = useCallback(
    (jobId: string, fileName = pending?.fileName ?? 'PDF') =>
      run(fileName, async (ctrl, onProgress) => ({ view: await driveImportJob(jobId, onProgress, { signal: ctrl.signal, pollMs: 4000 }), upload: null })),
    [run, pending],
  )

  const cancel = useCallback(() => abort.current?.abort(), [])
  const reset = useCallback(() => {
    abort.current?.abort()
    setState(IDLE)
  }, [])
  const discardPending = useCallback(() => {
    writePending(null)
    setPending(null)
  }, [])

  return { state, pending, start, resume, cancel, reset, discardPending }
}
