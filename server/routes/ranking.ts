import { Hono } from 'hono'
import { z } from 'zod'
import { rankingPeriodStart } from '../../shared/simulado'
import { requireUser, type AppEnv } from '../middleware'
import { getRanking } from '../services/ranking'

export const rankingRoutes = new Hono<AppEnv>().use(requireUser).get('/', async (c) => {
  const periodo = z.enum(['semana', 'mes', 'geral']).catch('semana').parse(c.req.query('periodo'))
  // Semana começa na segunda 00:00 de Brasília (shared/simulado.ts, testado).
  // Ranking por área (spec 004 › T018): só os pontos de simulados daquela área (área predominante do simulado).
  const area = z.uuid().optional().catch(undefined).parse(c.req.query('area') || undefined)
  const ranking = await getRanking(c.get('user')!.id, rankingPeriodStart(periodo), 50, area)
  return c.json({ periodo, area: area ?? null, ...ranking })
})

export type RankingRoutes = typeof rankingRoutes
