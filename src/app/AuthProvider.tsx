import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { setUnauthorizedHandler } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
// Fallback de DESENVOLVIMENTO (sem API): login simulado do protótipo. Remover com T036.
import { ME } from '@/mocks/data'
import { useStore } from '@/mocks/store'
import { AuthContext, type AuthMode, type AuthProfile, type AuthState, type AuthUser } from './auth-context'

interface MeResult {
  mode: AuthMode
  user: AuthUser | null
  profile: AuthProfile | null
}

const ME_KEY = ['me'] as const
const SIGNED_OUT: MeResult = { mode: 'real', user: null, profile: null }

/** GET /api/me (nunca 401). Em dev sem API (resposta não-JSON ou falha de rede) → modo protótipo. */
async function fetchMe(): Promise<MeResult> {
  let res: Response
  try {
    res = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
  } catch {
    if (import.meta.env.DEV) return { mode: 'prototipo', user: null, profile: null }
    throw new Error('Servidor indisponível. Tente novamente em instantes.')
  }
  if (!res.headers.get('content-type')?.includes('application/json')) {
    if (import.meta.env.DEV) return { mode: 'prototipo', user: null, profile: null }
    throw new Error('Servidor indisponível. Tente novamente em instantes.')
  }
  const body = (await res.json()) as { user: AuthUser | null; profile: AuthProfile | null; error?: string }
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`)
  return { mode: 'real', user: body.user, profile: body.profile }
}

/** Sessão do usuário (spec 001): GET /api/me na inicialização; 401 global; login/logout reais. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const store = useStore()
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity, retry: 1 })
  const mode = me.data?.mode ?? 'real'
  const realUser = me.data?.user ?? null

  // Não usar queryClient.clear(): ele remove a query ['me'] observada pelo useQuery acima, e o
  // setQueryData seguinte cria uma query nova que o observador não vê — a tela ficava "logada".
  const resetSession = useCallback(() => {
    queryClient.setQueryData(ME_KEY, SIGNED_OUT)
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
  }, [queryClient])

  // 401 em qualquer chamada: limpa o cache uma única vez; o guard redireciona para /login (FR-011).
  useEffect(() => {
    if (mode !== 'real' || !realUser) return
    setUnauthorizedHandler(resetSession)
    return () => setUnauthorizedHandler(null)
  }, [mode, realUser, resetSession])

  const signIn = useCallback(
    async (redirectTo: string) => {
      if (mode === 'prototipo') return store.login()
      const errorCallbackURL = `/login?redirect=${encodeURIComponent(redirectTo)}`
      const { error } = await authClient.signIn.social({ provider: 'google', callbackURL: redirectTo, errorCallbackURL })
      if (error) throw new Error(error.message ?? 'Não foi possível iniciar o login.')
    },
    [mode, store],
  )

  const signOut = useCallback(async () => {
    if (mode === 'prototipo') return store.logout()
    await authClient.signOut().catch(() => undefined)
    resetSession()
  }, [mode, store, resetSession])

  const refresh = useCallback(async () => {
    await me.refetch()
  }, [me])

  const value = useMemo<AuthState>(() => {
    const proto = mode === 'prototipo' && store.loggedIn
    return {
      status: me.isPending ? 'loading' : me.isError ? 'error' : 'ready',
      mode,
      user: mode === 'prototipo' ? (proto ? { id: ME.id, name: ME.name, email: ME.email, image: null } : null) : realUser,
      profile:
        mode === 'prototipo'
          ? proto
            ? { displayName: ME.name, institution: ME.institution, course: null, showInRanking: true, onboardedAt: null }
            : null
          : (me.data?.profile ?? null),
      error: me.error?.message ?? null,
      signIn,
      signOut,
      refresh,
    }
  }, [me.isPending, me.isError, me.error, me.data, mode, realUser, store.loggedIn, signIn, signOut, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
