import { and, count, eq, gte } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { auth } from './auth'
import { db, schema } from './db/client'
import { env } from './env'

export interface AppUser {
  id: string
  name: string
  email: string
  image?: string | null
}

export type AppEnv = { Variables: { user: AppUser | null } }

/** Carrega a sessão (cookie) em c.var.user. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const s = await auth().api.getSession({ headers: c.req.raw.headers })
  c.set('user', s?.user ? { id: s.user.id, name: s.user.name, email: s.user.email, image: s.user.image } : null)
  await next()
})

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) throw new HTTPException(401, { message: 'Faça login para continuar.' })
  await next()
})

const startOfDayUtc = () => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Orçamento de IA: protege a cota diária compartilhada da chave OpenRouter
 * (20 req/min e 1000 req/dia nos modelos gratuitos, com créditos ≥ US$10).
 */
export async function reserveAiRequest(userId: string) {
  const since = startOfDayUtc()
  const [[global], [mine]] = await Promise.all([
    db().select({ n: count() }).from(schema.aiCall).where(gte(schema.aiCall.createdAt, since)),
    db().select({ n: count() }).from(schema.aiCall).where(and(gte(schema.aiCall.createdAt, since), eq(schema.aiCall.userId, userId))),
  ])
  if (global.n >= env().AI_DAILY_BUDGET) throw new HTTPException(429, { message: 'Cota diária de IA do sistema atingida. Tente amanhã ou use o modo "agente externo".' })
  if (mine.n >= env().AI_USER_DAILY_LIMIT) throw new HTTPException(429, { message: 'Você atingiu seu limite diário de uso de IA.' })
}
