import type { ImportFile } from '@shared/schemas/import'
import { commitIssues, importCommitInput, toCommitInput, type CommitIssue, type CommitResult } from '@shared/schemas/import-commit'
import { ApiError, apiFetch } from '@/lib/api'
import type { ReviewState } from './drafts'

/**
 * Salvar a revisão no banco (spec 002 › Confirmação; T023/T027/T048):
 * todo método passa por um `import_job` (PDF já tem; agente externo e lote manual criam o seu)
 * e grava com `POST /api/imports/:id/commit` — validação idêntica no cliente e no servidor.
 */

/** Problema apontado na revisão: questão (draftId) ou card (cardId). */
export interface ReviewProblem {
  draftId?: string
  cardId?: string
  message: string
}

export class CommitError extends Error {
  readonly problems: ReviewProblem[]
  constructor(message: string, problems: ReviewProblem[] = []) {
    super(message)
    this.name = 'CommitError'
    this.problems = problems
  }
}

/** Mapeia os problemas (índices de card/questão do corpo) de volta para os ids da revisão. */
function toProblems(issues: CommitIssue[], review: ReviewState, refs: string[][]): ReviewProblem[] {
  const usedCards = review.cards.filter((c) => c.questionIds.some((id) => review.drafts[id]))
  return issues.map((i) => ({
    message: i.message,
    draftId: i.question != null ? refs[i.card]?.[i.question] : undefined,
    cardId: i.question == null ? usedCards[i.card]?.id : undefined,
  }))
}

/** Pré-validação local (mesmo schema do servidor): nada é enviado se houver problema. */
export function prepareCommit(review: ReviewState) {
  const { body, refs } = toCommitInput(review.cards, review.drafts)
  const parsed = importCommitInput.safeParse(body)
  return { body, refs, problems: parsed.success ? [] : toProblems(commitIssues(parsed.error), review, refs) }
}

async function post<T>(url: string, body: unknown): Promise<{ status: number; data: T & { error?: string; items?: CommitIssue[] } }> {
  let res: Response
  try {
    res = await apiFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Suas edições continuam na tela: tente de novo.')
  }
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = (isJson ? await res.json().catch(() => ({})) : {}) as T & { error?: string; items?: CommitIssue[] }
  if (res.status === 413) throw new ApiError(413, 'A importação ficou grande demais para enviar de uma vez. Divida em partes (remova alguns cards e salve em duas vezes).')
  if (!isJson) throw new ApiError(res.ok ? 503 : res.status, 'API indisponível.')
  return { status: res.status, data }
}

/** Cria o job da importação (agente externo: guarda o JSON validado; manual: lote digitado). */
export async function createReviewJob(input: { source: 'agente_externo'; payload: ImportFile } | { source: 'manual'; fileName?: string }): Promise<string> {
  const { status, data } = await post<{ id: string }>('/api/imports', input)
  if (status !== 201) throw new ApiError(status, data.error ?? `Erro ${status}`)
  return data.id
}

/**
 * Valida, cria o job se faltar (avisando via `onJob` para não criar outro numa nova tentativa) e grava.
 * Erros: `CommitError` (itens a ajustar) ou `ApiError` (rede/servidor).
 */
export async function commitReview(review: ReviewState, onJob?: (jobId: string) => void): Promise<CommitResult> {
  const { body, refs, problems } = prepareCommit(review)
  if (problems.length) throw new CommitError(`${problems.length} ${problems.length === 1 ? 'item precisa' : 'itens precisam'} de ajuste antes de salvar.`, problems)
  let jobId = review.jobId
  if (!jobId) {
    jobId = await createReviewJob(
      review.source === 'agente_externo' && review.payload ? { source: 'agente_externo', payload: review.payload } : { source: 'manual', fileName: review.fileName },
    )
    onJob?.(jobId)
  }
  const { status, data } = await post<CommitResult>(`/api/imports/${encodeURIComponent(jobId)}/commit`, body)
  if (status === 400) throw new CommitError(data.error ?? 'Revise os itens apontados.', toProblems(data.items ?? [], review, refs))
  if (status !== 200) throw new ApiError(status, data.error ?? `Erro ${status}`)
  return data
}
