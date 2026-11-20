import { desc, eq, gte, or, sql, sum } from 'drizzle-orm'
import { db, schema } from '../db/client'

export interface RankingRow {
  userId: string
  name: string
  image: string | null
  institution: string | null
  points: number
  me: boolean
}

/**
 * Ranking por período (docs/07): soma do `points_ledger` a partir de `start` (null = geral).
 * Nome exibido = `profile.display_name` (fallback: nome do Google). Quem desativou
 * "Aparecer no ranking" some para os OUTROS, mas continua vendo a própria linha (spec 001 › US3, SC-003).
 */
export async function getRanking(viewerId: string, start: Date | null, limit = 50): Promise<RankingRow[]> {
  const l = schema.pointsLedger
  const p = schema.profile
  const total = sum(l.points).mapWith(Number)
  const rows = await db()
    .select({
      userId: l.userId,
      name: sql<string>`coalesce(${p.displayName}, ${schema.user.name})`,
      image: schema.user.image,
      institution: p.institution,
      points: total,
    })
    .from(l)
    .innerJoin(schema.user, eq(schema.user.id, l.userId))
    .leftJoin(p, eq(p.userId, l.userId))
    .where(start ? gte(l.createdAt, start) : sql`true`)
    .groupBy(l.userId, schema.user.name, schema.user.image, p.displayName, p.institution, p.showInRanking)
    .having(or(sql`coalesce(${p.showInRanking}, true)`, eq(l.userId, viewerId)))
    .orderBy(desc(total))
    .limit(limit)
  return rows.map((r) => ({ ...r, me: r.userId === viewerId }))
}
