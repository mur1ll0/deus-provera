import { desc, eq, gte, sql, sum } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { rankingPeriodStart } from '../../shared/simulado'
import { db, schema } from '../db/client'
import { requireUser, type AppEnv } from '../middleware'

export const rankingRoutes = new Hono<AppEnv>().use(requireUser).get('/', async (c) => {
  const periodo = z.enum(['semana', 'mes', 'geral']).catch('semana').parse(c.req.query('periodo'))
  // Semana começa na segunda 00:00 de Brasília (shared/simulado.ts, testado).
  const start = rankingPeriodStart(periodo)
  const l = schema.pointsLedger
  const total = sum(l.points).mapWith(Number)
  const rows = await db()
    .select({ userId: l.userId, name: schema.user.name, image: schema.user.image, points: total })
    .from(l)
    .innerJoin(schema.user, eq(schema.user.id, l.userId))
    .leftJoin(schema.profile, eq(schema.profile.userId, l.userId))
    .where(start ? gte(l.createdAt, start) : sql`true`)
    .groupBy(l.userId, schema.user.name, schema.user.image)
    .having(sql`coalesce(bool_and(${schema.profile.showInRanking}), true)`)
    .orderBy(desc(total))
    .limit(50)
  return c.json({ periodo, rows })
})
