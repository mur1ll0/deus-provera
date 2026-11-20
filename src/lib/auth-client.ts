import { createAuthClient } from 'better-auth/react'

/**
 * Cliente do Better Auth. Mesma origem da API (/api/auth/*): sessão em cookie httpOnly,
 * nada de token no localStorage (spec 001, SC-005).
 */
export const authClient = createAuthClient({ basePath: '/api/auth' })
