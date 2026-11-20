import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db, schema } from './db/client'
import { env } from './env'
import { ensureProfile } from './services/profile'

/**
 * Autenticação: Better Auth + Google OAuth, sessão por cookie httpOnly no mesmo domínio
 * (SPA e API servidos pela mesma origem na Vercel → sem CORS).
 * Docs: https://www.better-auth.com/docs/integrations/hono
 */
let instance: ReturnType<typeof create> | null = null

function create() {
  const e = env()
  return betterAuth({
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    socialProviders: {
      google: {
        clientId: e.GOOGLE_CLIENT_ID,
        clientSecret: e.GOOGLE_CLIENT_SECRET,
        // Escopos mínimos: nome, e-mail e foto.
        scope: ['openid', 'email', 'profile'],
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 dias
      updateAge: 60 * 60 * 24, // renova 1x/dia
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Perfil criado no primeiro login (FR-006).
    databaseHooks: {
      user: { create: { after: async (u) => ensureProfile(u.id, u.name) } },
    },
    // Erros do OAuth (ex.: usuário cancelou no Google) voltam para a tela de login com ?error=…
    onAPIError: { errorURL: '/login' },
    trustedOrigins: [e.BETTER_AUTH_URL],
  })
}

export function auth() {
  instance ??= create()
  return instance
}
