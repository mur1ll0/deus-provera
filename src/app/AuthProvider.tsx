import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ACCOUNT_DELETE_CONFIRM, ProfilePatch } from '@shared/schemas/profile'
import { api, setUnauthorizedHandler, unwrap } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
// Fallback de DESENVOLVIMENTO (sem API): identidade fictícia do protótipo (exceção em CLAUDE.md).
import { ME } from '@/mocks/data'
import { AuthContext, type AuthMode, type AuthProfile, type AuthState, type AuthUser } from './auth-context'

interface MeResult {
  mode: AuthMode
  user: AuthUser | null
  profile: AuthProfile | null
}

const ME_KEY = ['me'] as const
const SIGNED_OUT: MeResult = { mode: 'real', user: null, profile: null }
const PROTO_USER: AuthUser = { id: ME.id, name: ME.name, email: ME.email, image: null }
const PROTO_PROFILE: AuthProfile = { displayName: ME.name, institution: ME.institution, course: null, showInRanking: true, onboardedAt: null }

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
  // Modo protótipo (dev sem API): sessão só em memória — recarregar a página pede "login" de novo (T036).
  const [protoProfile, setProtoProfile] = useState<AuthProfile | null>(null)
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
      if (mode === 'prototipo') return setProtoProfile(PROTO_PROFILE)
      const errorCallbackURL = `/login?redirect=${encodeURIComponent(redirectTo)}`
      const { error } = await authClient.signIn.social({ provider: 'google', callbackURL: redirectTo, errorCallbackURL })
      if (error) throw new Error(error.message ?? 'Não foi possível iniciar o login.')
    },
    [mode],
  )

  const signOut = useCallback(async () => {
    if (mode === 'prototipo') return setProtoProfile(null)
    await authClient.signOut().catch(() => undefined)
    resetSession()
  }, [mode, resetSession])

  const updateProfile = useCallback(
    async (patch: ProfilePatch): Promise<AuthProfile> => {
      if (mode === 'prototipo') {
        const next = { ...(protoProfile ?? PROTO_PROFILE), ...patch, onboardedAt: patch.onboarded ? new Date().toISOString() : (protoProfile?.onboardedAt ?? null) }
        delete (next as { onboarded?: unknown }).onboarded
        setProtoProfile(next)
        return next
      }
      const profile = await unwrap(api.profile.index.$patch({ json: patch }))
      queryClient.setQueryData<MeResult>(ME_KEY, (prev) => (prev ? { ...prev, profile } : prev))
      return profile
    },
    [mode, protoProfile, queryClient],
  )

  const deleteAccount = useCallback(
    async (confirm: string) => {
      if (mode === 'prototipo') return setProtoProfile(null)
      await unwrap(api.account.index.$delete({ json: { confirm: confirm as typeof ACCOUNT_DELETE_CONFIRM } }))
      resetSession()
    },
    [mode, resetSession],
  )

  const refresh = useCallback(async () => {
    await me.refetch()
  }, [me])

  const value = useMemo<AuthState>(() => {
    const proto = mode === 'prototipo'
    return {
      status: me.isPending ? 'loading' : me.isError ? 'error' : 'ready',
      mode,
      user: proto ? (protoProfile ? PROTO_USER : null) : realUser,
      profile: proto ? protoProfile : (me.data?.profile ?? null),
      error: me.error?.message ?? null,
      signIn,
      signOut,
      refresh,
      updateProfile,
      deleteAccount,
    }
  }, [me.isPending, me.isError, me.error, me.data, mode, realUser, protoProfile, signIn, signOut, refresh, updateProfile, deleteAccount])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
