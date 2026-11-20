import { hc } from 'hono/client'
import type { AccountRoutes, ProfileRoutes } from '../../server/routes/profile'
import type { QuestionsRoutes } from '../../server/routes/questions'
import type { RankingRoutes } from '../../server/routes/ranking'
import type { SimuladosRoutes } from '../../server/routes/simulados'
import type { StatsRoutes } from '../../server/routes/stats'
import type { TaxonomyRoutes } from '../../server/routes/taxonomy'

/**
 * Cliente HTTP da API (Hono RPC, tipado a partir das rotas do servidor).
 * - mesma origem, cookie de sessão (`credentials: 'same-origin'`);
 * - erro padronizado `{ error }` → ApiError;
 * - 401 tratado globalmente UMA vez (spec 001, FR-011): o AuthProvider limpa o estado e o guard leva ao /login.
 */

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

let onUnauthorized: (() => void) | null = null
let unauthorizedFired = false

/** Registrado pelo AuthProvider. Rearmado a cada login. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
  unauthorizedFired = false
}

export const apiFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, { ...init, credentials: 'same-origin' })
  if (res.status === 401 && !unauthorizedFired) {
    unauthorizedFired = true
    onUnauthorized?.()
  }
  return res
}

/** Lê o corpo de sucesso ou lança ApiError com a mensagem do servidor. */
export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(p: Promise<R>): Promise<Awaited<ReturnType<R['json']>>> {
  let res: R
  try {
    res = await p
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet.')
  }
  if (res.status === 204) return undefined as Awaited<ReturnType<R['json']>>
  const isJson = (res as unknown as Response).headers?.get('content-type')?.includes('application/json')
  if (!res.ok || !isJson) {
    const body = isJson ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
    throw new ApiError(res.ok ? 503 : res.status, body?.error ?? (isJson ? `Erro ${res.status}` : 'API indisponível.'))
  }
  return (await res.json()) as Awaited<ReturnType<R['json']>>
}

export const api = {
  questions: hc<QuestionsRoutes>('/api/questions', { fetch: apiFetch }),
  taxonomy: hc<TaxonomyRoutes>('/api/taxonomy', { fetch: apiFetch }),
  profile: hc<ProfileRoutes>('/api/profile', { fetch: apiFetch }),
  account: hc<AccountRoutes>('/api/account', { fetch: apiFetch }),
  ranking: hc<RankingRoutes>('/api/ranking', { fetch: apiFetch }),
  simulados: hc<SimuladosRoutes>('/api/simulados', { fetch: apiFetch }),
  stats: hc<StatsRoutes>('/api/stats', { fetch: apiFetch }),
}
