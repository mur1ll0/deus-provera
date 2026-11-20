import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { performanceGrade } from '../../shared/scoring'
import { brtDay, computeStreak, lastDays, MIN_ANSWERS_FOR_GRADE, MIN_ANSWERS_FOR_WEAKEST } from '../../shared/stats'
import { db, schema } from '../db/client'
import { getRanking } from './ranking'

/** Painel do estudante (spec 004 › US1): `GET /api/stats/me`. */
export interface DashboardView {
  points: number
  rank: number | null
  grade: number | null
  /** Variação da nota em relação a 7 dias atrás. */
  gradeDelta: number | null
  answered: number
  accuracy: number | null
  simulados: number
  provas14d: number
  avgSecPerQuestion: number | null
  streak: { current: number; best: number }
  myQuestions: number
  topics: { discipline: string; topic: string | null; accuracy: number; answered: number }[]
  weakest: { discipline: string; topic: string | null; accuracy: number } | null
  /** Perguntas respondidas por dia (BRT), 28 dias, do mais antigo ao mais recente. */
  activity28d: { day: string; count: number }[]
  recent: { id: string; title: string; mode: 'prova' | 'treino'; finishedAt: string; questions: number; accuracy: number; points: number; timeMin: number }[]
}

const DAY = 86_400_000

export async function getDashboard(userId: string): Promise<DashboardView> {
  const { attempt, attemptAnswer, question, discipline } = schema
  const [answers, attempts, [{ mine }], ranking] = await Promise.all([
    db()
      .select({ score: attemptAnswer.score, at: attempt.finishedAt, mode: attempt.mode, topic: question.topic, discipline: discipline.name })
      .from(attemptAnswer)
      .innerJoin(attempt, eq(attempt.id, attemptAnswer.attemptId))
      .innerJoin(question, eq(question.id, attemptAnswer.questionId))
      .innerJoin(discipline, eq(discipline.id, question.disciplineId))
      .where(and(eq(attempt.userId, userId), isNotNull(attempt.finishedAt)))
      .orderBy(desc(attempt.finishedAt))
      .limit(10_000),
    db()
      .select()
      .from(attempt)
      .where(and(eq(attempt.userId, userId), isNotNull(attempt.finishedAt)))
      .orderBy(desc(attempt.finishedAt))
      .limit(500),
    db()
      .select({ mine: count() })
      .from(question)
      .where(and(eq(question.ownerId, userId), isNull(question.deletedAt))),
    getRanking(userId, null),
  ])

  const now = Date.now()
  const graded = answers.filter((a) => a.score != null)
  const gradeAt = (until: number) => {
    const win = graded.filter((a) => a.at!.getTime() <= until && a.at!.getTime() > until - 30 * DAY)
    return win.length >= MIN_ANSWERS_FOR_GRADE ? performanceGrade(win.map((a) => ({ score: a.score!, mode: a.mode }))) : null
  }
  const grade = gradeAt(now)
  const before = gradeAt(now - 7 * DAY)

  const byTopic = new Map<string, { discipline: string; topic: string | null; sum: number; n: number }>()
  for (const a of graded) {
    const k = `${a.discipline}|${a.topic ?? ''}`
    const t = byTopic.get(k) ?? { discipline: a.discipline, topic: a.topic, sum: 0, n: 0 }
    t.sum += a.score!
    t.n++
    byTopic.set(k, t)
  }
  const topics = [...byTopic.values()].map((t) => ({ discipline: t.discipline, topic: t.topic, accuracy: t.sum / t.n, answered: t.n })).sort((x, y) => y.answered - x.answered)
  const weakest = [...topics].filter((t) => t.answered >= MIN_ANSWERS_FOR_WEAKEST).sort((x, y) => x.accuracy - y.accuracy)[0] ?? null

  const perDay = new Map<string, number>()
  for (const a of answers) {
    const d = brtDay(a.at!)
    perDay.set(d, (perDay.get(d) ?? 0) + 1)
  }
  const totalQuestions = attempts.reduce((acc, x) => acc + x.questionIds.length, 0)
  const totalMs = attempts.reduce((acc, x) => acc + (x.totalTimeMs ?? 0), 0)

  return {
    points: ranking.me?.points ?? 0,
    rank: ranking.me?.pos ?? null,
    grade,
    gradeDelta: grade != null && before != null ? Math.round((grade - before) * 10) / 10 : null,
    answered: answers.length,
    accuracy: graded.length ? graded.reduce((acc, a) => acc + a.score!, 0) / graded.length : null,
    simulados: attempts.length,
    provas14d: attempts.filter((x) => x.mode === 'prova' && x.finishedAt!.getTime() > now - 14 * DAY).length,
    avgSecPerQuestion: totalQuestions ? Math.round(totalMs / totalQuestions / 1000) : null,
    streak: computeStreak(perDay.keys()),
    myQuestions: mine,
    topics: topics.slice(0, 8),
    weakest: weakest && { discipline: weakest.discipline, topic: weakest.topic, accuracy: weakest.accuracy },
    activity28d: lastDays(28).map((day) => ({ day, count: perDay.get(day) ?? 0 })),
    recent: attempts.slice(0, 10).map((x) => {
      const cfg = x.config as { mode: 'prova' | 'treino'; topics?: string[] }
      return {
        id: x.id,
        title: `${x.mode === 'prova' ? 'Prova' : 'Treino'}${cfg.topics?.length ? ` · ${cfg.topics.slice(0, 2).join(', ')}` : ''}`,
        mode: x.mode,
        finishedAt: x.finishedAt!.toISOString(),
        questions: x.questionIds.length,
        accuracy: x.accuracy ?? 0,
        points: x.points ?? 0,
        timeMin: Math.round((x.totalTimeMs ?? 0) / 60_000),
      }
    }),
  }
}

