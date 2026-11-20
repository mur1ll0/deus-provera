import { Hono } from 'hono'
import { requireUser, type AppEnv } from '../middleware'
import { getDashboard } from '../services/stats'

/** Painel do estudante (spec 004 › US1). */
export const statsRoutes = new Hono<AppEnv>().use(requireUser).get('/me', async (c) => c.json(await getDashboard(c.get('user')!.id)))

export type StatsRoutes = typeof statsRoutes
