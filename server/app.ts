import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { setAiRecorder } from './ai/client'
import { auth } from './auth'
import { db, schema } from './db/client'
import { sessionMiddleware, type AppEnv } from './middleware'
import { aiRoutes } from './routes/ai'
import { cronRoutes } from './routes/cron'
import { importsRoutes } from './routes/imports'
import { accountRoutes, profileRoutes } from './routes/profile'
import { questionsRoutes } from './routes/questions'
import { rankingRoutes } from './routes/ranking'
import { simuladosRoutes } from './routes/simulados'
import { statsRoutes } from './routes/stats'
import { taxonomyRoutes } from './routes/taxonomy'
import { getProfile } from './services/profile'

/**
 * API do Deus Proverá (Hono). Servida pela Vercel como UMA função em api/index.ts.
 * Rotas: docs/04-arquitetura.md § API.
 */
export const app = new Hono<AppEnv>().basePath('/api')

// Telemetria de IA → ai_call (usada pelo orçamento diário em middleware.reserveAiRequest)
setAiRecorder(async ({ userId, task, log }) => {
  await db().insert(schema.aiCall).values({ userId: userId ?? null, task, model: log.model, ok: log.ok, errorKind: log.errorKind ?? null, latencyMs: log.latencyMs })
})

app.use(logger())
app.use(secureHeaders())

// Better Auth: /api/auth/* (login Google, callback, sessão, logout)
app.on(['GET', 'POST'], '/auth/*', (c) => auth().handler(c.req.raw))

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))
// Rotinas agendadas: autenticação própria (CRON_SECRET), sem sessão.
app.route('/cron', cronRoutes)

app.use(sessionMiddleware)
// Nunca responde 401: o SPA usa para decidir o redirecionamento (FR-003).
app.get('/me', async (c) => {
  const user = c.get('user')
  return c.json({ user, profile: user ? await getProfile(user.id, user.name) : null })
})
app.route('/profile', profileRoutes)
app.route('/account', accountRoutes)
app.route('/questions', questionsRoutes)
app.route('/taxonomy', taxonomyRoutes)
app.route('/imports', importsRoutes)
app.route('/simulados', simuladosRoutes)
app.route('/ranking', rankingRoutes)
app.route('/stats', statsRoutes)
app.route('/ai', aiRoutes)

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message || 'Erro' }, err.status)
  console.error(err)
  return c.json({ error: 'Erro interno' }, 500)
})

export type AppType = typeof app
