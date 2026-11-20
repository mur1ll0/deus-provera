import { and, desc, eq, gte, inArray, isNotNull, or, sql, sum } from 'drizzle-orm'
import { MIN_ANSWERS_FOR_GRADE } from '../../shared/stats'
import { db, schema } from '../db/client'

export interface RankingRow {
  pos: number
  userId: string
  name: string
  image: string | null
  institution: string | null
  points: number
  /** Nota de desempenho (0–10) dos últimos 30 dias; null com menos de 10 respostas corrigidas. */
  grade: number | null
  /** Simulados finalizados no período. */
  simulados: number
  me: boolean
}

export interface Ranking {
  rows: RankingRow[]
  /** Linha do próprio usuário (mesmo fora do top). */
  me: RankingRow | null
}

/** Nota de desempenho por usuário (shared/scoring.ts › performanceGrade, em SQL): prova pesa 2, treino 1. */
async function gradesByUser(userIds: string[]): Promise<Map<string, number | null>> {
  if (!userIds.length) return new Map()
  const { attempt, attemptAnswer } = schema
  const w = sql`case when ${attempt.mode} = 'prova' then 2 else 1 end`
  const rows = await db()
    .select({
      userId: attempt.userId,
      acc: sql<number>`sum(${attemptAnswer.score} * ${w})::float / nullif(sum(${w}), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(attemptAnswer)
    .innerJoin(attempt, eq(attempt.id, attemptAnswer.attemptId))
    .where(and(inArray(attempt.userId, userIds), isNotNull(attemptAnswer.score), gte(attempt.finishedAt, new Date(Date.now() - 30 * 86_400_000))))
    .groupBy(attempt.userId)
  return new Map(rows.map((r) => [r.userId, r.n >= MIN_ANSWERS_FOR_GRADE ? Math.round(r.acc * 100) / 10 : null]))
}

/**
 * Ranking por período (docs/07): soma do `points_ledger` a partir de `start` (null = geral).
 * Nome exibido = `profile.display_name` (fallback: nome do Google). Quem desativou
 * "Aparecer no ranking" some para os OUTROS, mas continua vendo a própria linha (spec 001 › US3, SC-003).
 * Desempate: mais simulados no período, depois id (estável).
 */
export async function getRanking(viewerId: string, start: Date | null, limit = 50): Promise<Ranking> {
  const l = schema.pointsLedger
  const p = schema.profile
  const total = sum(l.points).mapWith(Number)
  const simulados = sql<number>`count(distinct ${l.attemptId}) filter (where ${l.reason} like 'simulado:%')`.mapWith(Number)
  const rows = await db()
    .select({
      userId: l.userId,
      name: sql<string>`coalesce(${p.displayName}, ${schema.user.name})`,
      image: schema.user.image,
      institution: p.institution,
      points: total,
      simulados,
    })
    .from(l)
    .innerJoin(schema.user, eq(schema.user.id, l.userId))
    .leftJoin(p, eq(p.userId, l.userId))
    .where(start ? gte(l.createdAt, start) : sql`true`)
    .groupBy(l.userId, schema.user.name, schema.user.image, p.displayName, p.institution, p.showInRanking)
    .having(or(sql`coalesce(${p.showInRanking}, true)`, eq(l.userId, viewerId)))
    .orderBy(desc(total), desc(simulados), l.userId)
    .limit(1000)
  const ranked = rows.map((r, i) => ({ ...r, pos: i + 1, me: r.userId === viewerId }))
  const top = ranked.slice(0, limit)
  const mine = ranked.find((r) => r.me) ?? null
  const grades = await gradesByUser([...new Set([...top, ...(mine ? [mine] : [])].map((r) => r.userId))])
  const withGrade = (r: (typeof ranked)[number]): RankingRow => ({ ...r, grade: grades.get(r.userId) ?? null })
  return { rows: top.map(withGrade), me: mine ? withGrade(mine) : null }
}
