import { Hono } from 'hono'
import { z } from 'zod'
import { rankingPeriodStart } from '../../shared/simulado'
import { requireUser, type AppEnv } from '../middleware'
import { getRanking } from '../services/ranking'

export const rankingRoutes = new Hono<AppEnv>().use(requireUser).get('/', async (c) => {
  const periodo = z.enum(['semana', 'mes', 'geral']).catch('semana').parse(c.req.query('periodo'))
  // Semana começa na segunda 00:00 de Brasília (shared/simulado.ts, testado).
  const rows = await getRanking(c.get('user')!.id, rankingPeriodStart(periodo))
  return c.json({ periodo, rows })
})

export type RankingRoutes = typeof rankingRoutes
