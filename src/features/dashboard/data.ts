import { useQuery } from '@tanstack/react-query'
import { initials, useAuth } from '@/app/auth-context'
import { api, unwrap } from '@/lib/api'
import { ACTIVITY_28D, MY_HISTORY, RANKING, TOPIC_PERFORMANCE } from '@/mocks/data'
import { useStore } from '@/mocks/store'

/**
 * Dados do painel e do ranking (spec 004): da API real (`/api/stats/me`, `/api/ranking`)
 * ou, no protótipo sem API, dos dados simulados de `src/mocks`.
 */

export type Period = 'semana' | 'mes' | 'geral'

export interface DashboardData {
  points: number
  rank: number | null
  grade: number | null
  gradeDelta: number | null
  answered: number
  accuracy: number | null
  simulados: number
  provas14d: number
  avgSecPerQuestion: number | null
  streak: { current: number; best: number }
  myQuestions: number
  topics: { topic: string; discipline: string; accuracy: number; answered: number }[]
  weakest: { topic: string; discipline: string; accuracy: number } | null
  activity: { day: string; count: number }[]
  history: { id: string; title: string; date: string; mode: 'prova' | 'treino'; questions: number; accuracy: number; points: number; timeMin: number; href?: string }[]
}

export interface RankRow {
  userId: string
  pos: number
  name: string
  avatarSeed: string
  image?: string | null
  institution?: string | null
  points: number
  grade: number | null
  simulados: number
  me: boolean
}

function mockDashboard(meId: string, myQuestions: number): DashboardData {
  const mine = RANKING.find((r) => r.userId === meId)!
  const answered = MY_HISTORY.reduce((a, h) => a + h.questions, 0)
  const weakest = [...TOPIC_PERFORMANCE].sort((a, b) => a.accuracy - b.accuracy)[0]
  return {
    points: mine.points,
    rank: [...RANKING].sort((a, b) => b.points - a.points).findIndex((r) => r.userId === meId) + 1,
    grade: mine.grade,
    gradeDelta: 0.4,
    answered,
    accuracy: MY_HISTORY.reduce((a, h) => a + h.accuracy * h.questions, 0) / answered,
    simulados: mine.simulados,
    provas14d: MY_HISTORY.filter((h) => h.mode === 'prova').length,
    avgSecPerQuestion: Math.round((MY_HISTORY.reduce((a, h) => a + h.timeMin, 0) * 60) / answered),
    streak: { current: 6, best: 11 },
    myQuestions,
    topics: TOPIC_PERFORMANCE,
    weakest,
    activity: ACTIVITY_28D.map((count, i) => ({ day: `dia ${i + 1}`, count })),
    history: MY_HISTORY,
  }
}

export function useDashboardData(): { data: DashboardData | null; loading: boolean; error: string | null } {
  const { mode } = useAuth()
  const store = useStore()
  const real = mode === 'real'
  const q = useQuery({ queryKey: ['stats', 'me'], queryFn: () => unwrap(api.stats.me.$get()), enabled: real, staleTime: 30_000 })
  if (!real) return { data: mockDashboard(store.me.id, store.questions.filter((x) => x.ownerId === store.me.id).length), loading: false, error: null }
  const d = q.data
  return {
    loading: q.isPending,
    error: q.error?.message ?? null,
    data: d
      ? {
          ...d,
          topics: d.topics.map((t) => ({ ...t, topic: t.topic ?? 'Sem assunto' })),
          weakest: d.weakest && { ...d.weakest, topic: d.weakest.topic ?? 'Sem assunto' },
          activity: d.activity28d,
          history: d.recent.map((h) => ({ ...h, date: h.finishedAt, href: `/simulados/${h.id}/resultado` })),
        }
      : null,
  }
}

// No protótipo, semana/mês são frações determinísticas do total geral.
const PERIOD_FACTOR: Record<Period, (i: number) => number> = {
  semana: (i) => 0.08 + ((i * 37) % 11) / 100,
  mes: (i) => 0.3 + ((i * 17) % 13) / 100,
  geral: () => 1,
}

export function useRankingData(period: Period): { rows: RankRow[]; me: RankRow | null; loading: boolean; error: string | null } {
  const { mode } = useAuth()
  const store = useStore()
  const real = mode === 'real'
  const q = useQuery({ queryKey: ['ranking', period], queryFn: () => unwrap(api.ranking.index.$get({ query: { periodo: period } })), enabled: real, staleTime: 60_000 })
  if (!real) {
    const rows = RANKING.map((r, i) => ({ ...r, points: Math.round(r.points * PERIOD_FACTOR[period](i)) }))
      .sort((a, b) => b.points - a.points || b.grade - a.grade)
      .map((r, i): RankRow => ({ userId: r.userId, pos: i + 1, name: r.name, avatarSeed: r.avatarSeed, institution: r.institution, points: r.points, grade: r.grade, simulados: r.simulados, me: r.userId === store.me.id }))
    return { rows, me: rows.find((r) => r.me) ?? null, loading: false, error: null }
  }
  const toRow = (r: NonNullable<typeof q.data>['rows'][number]): RankRow => ({ ...r, avatarSeed: initials(r.name) })
  return { rows: q.data?.rows.map(toRow) ?? [], me: q.data?.me ? toRow(q.data.me) : null, loading: q.isPending, error: q.error?.message ?? null }
}
