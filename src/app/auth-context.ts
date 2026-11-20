import { createContext, useContext } from 'react'
import type { ProfilePatch } from '@shared/schemas/profile'

export interface AuthUser {
  id: string
  name: string
  email: string
  image?: string | null
}

export interface AuthProfile {
  displayName: string | null
  institution: string | null
  course: string | null
  showInRanking: boolean
  onboardedAt: string | null
}

/**
 * - real: sessão do Better Auth (GET /api/me).
 * - prototipo: só em desenvolvimento, quando não há API (ex.: `npm run dev` sem backend) —
 *   login simulado do protótipo, para as telas mock continuarem navegáveis.
 */
export type AuthMode = 'real' | 'prototipo'

export interface AuthState {
  status: 'loading' | 'ready' | 'error'
  mode: AuthMode
  user: AuthUser | null
  profile: AuthProfile | null
  error: string | null
  /** Inicia o login com Google e volta para `redirectTo` (caminho interno). */
  signIn: (redirectTo: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  /** PATCH /api/profile e atualiza o perfil em memória (sidebar, painel). */
  updateProfile: (patch: ProfilePatch) => Promise<AuthProfile>
  /** DELETE /api/account (`confirm` = "EXCLUIR") e encerra a sessão local. */
  deleteAccount: (confirm: string) => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

/** Só caminhos internos (evita open redirect via ?redirect=). */
export function safeRedirect(path: string | null | undefined): string {
  return path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login') ? path : '/'
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?'
