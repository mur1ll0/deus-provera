import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Logo } from '@/components/Logo'
import { useAuth } from './auth-context'

/** Guard de rota (spec 001, FR-005): sem sessão → /login?redirect=<rota de origem>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') return <FullScreen>Carregando…</FullScreen>
  if (auth.status === 'error')
    return (
      <FullScreen>
        <p role="alert">{auth.error}</p>
        <button className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white" onClick={() => void auth.refresh()}>
          Tentar novamente
        </button>
      </FullScreen>
    )
  if (!auth.user) {
    const from = location.pathname + location.search
    return <Navigate to={`/login?redirect=${encodeURIComponent(from)}`} replace />
  }
  return children
}

export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center text-sm text-muted" aria-live="polite">
      <Logo />
      <div>{children}</div>
    </div>
  )
}
