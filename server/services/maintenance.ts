import { and, isNull, lt, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'

/**
 * Rotinas diárias (Vercel Cron → /api/cron/daily):
 *  - spec 003 › T032: tentativas em andamento há mais de 24 h viram "abandonadas" (fechadas, sem pontos);
 *  - spec 005 › T044: telemetria `ai_call` com mais de 90 dias é apagada.
 */

const DAY = 86_400_000

export async function abandonStaleAttempts(now = new Date()): Promise<number> {
  const a = schema.attempt
  const rows = await db()
    .update(a)
    .set({
      finishedAt: now,
      abandonedAt: now,
      totalTimeMs: sql`least(coalesce(${a.timeLimitMs}, 86400000), ${24 * 3_600_000})`,
      points: 0,
      countsForRanking: false,
      scoreDetail: { base: 0, timeBonus: 0, total: 0, accuracy: 0, countsForRanking: false, pending: 0 },
    })
    .where(and(isNull(a.finishedAt), lt(a.startedAt, new Date(now.getTime() - DAY))))
    .returning({ id: a.id })
  return rows.length
}

export async function pruneAiCalls(now = new Date()): Promise<number> {
  const rows = await db()
    .delete(schema.aiCall)
    .where(lt(schema.aiCall.createdAt, new Date(now.getTime() - 90 * DAY)))
    .returning({ id: schema.aiCall.id })
  return rows.length
}
