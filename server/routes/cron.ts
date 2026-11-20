import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { abandonStaleAttempts, pruneAiCalls } from '../services/maintenance'

/**
 * Rotinas agendadas (vercel.json › crons). A Vercel envia `Authorization: Bearer <CRON_SECRET>`;
 * sem `CRON_SECRET` configurado a rota fica desligada (nunca pública).
 */
export const cronRoutes = new Hono().get('/daily', async (c) => {
  // Lido a cada chamada (não do cache de env): trocar o segredo na Vercel vale no próximo deploy/instância.
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) throw new HTTPException(503, { message: 'Rotinas agendadas desligadas (CRON_SECRET ausente).' })
  if (c.req.header('authorization') !== `Bearer ${secret}`) throw new HTTPException(401, { message: 'Não autorizado.' })
  const [abandoned, aiCallsPruned] = await Promise.all([abandonStaleAttempts(), pruneAiCalls()])
  return c.json({ ok: true, abandoned, aiCallsPruned })
})
