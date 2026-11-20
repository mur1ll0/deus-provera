import clsx from 'clsx'
import { Crown, Info, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { RANKING } from '@/mocks/data'
import { useStore } from '@/mocks/store'
import { Avatar, Card, Segmented } from './ui'

type Period = 'semana' | 'mes' | 'geral'

// No protótipo, semana/mês são frações determinísticas do total geral.
const PERIOD_FACTOR: Record<Period, (i: number) => number> = {
  semana: (i) => 0.08 + ((i * 37) % 11) / 100,
  mes: (i) => 0.3 + ((i * 17) % 13) / 100,
  geral: () => 1,
}

export function RankingPanel({ limit = 8, className }: { limit?: number; className?: string }) {
  const { me } = useStore()
  const [period, setPeriod] = useState<Period>('semana')

  const rows = useMemo(
    () =>
      RANKING.map((r, i) => ({ ...r, points: Math.round(r.points * PERIOD_FACTOR[period](i)) }))
        .sort((a, b) => b.points - a.points || b.grade - a.grade)
        .map((r, i) => ({ ...r, pos: i + 1 })),
    [period],
  )
  const mine = rows.find((r) => r.userId === me.id)
  const top = rows.slice(0, limit)
  const meInTop = top.some((r) => r.userId === me.id)

  return (
    <Card className={clsx('p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Trophy size={18} className="text-gold-600" /> Ranking
        </h2>
        <Link to="/ranking" className="text-xs font-bold text-brand-600 hover:underline">
          ver completo
        </Link>
      </div>
      <Segmented
        value={period}
        onChange={setPeriod}
        className="mb-4 w-full [&>button]:flex-1"
        options={[
          { value: 'semana', label: 'Semana' },
          { value: 'mes', label: 'Mês' },
          { value: 'geral', label: 'Geral' },
        ]}
      />
      <ol className="space-y-1">
        {top.map((r) => (
          <RankRow key={r.userId} row={r} isMe={r.userId === me.id} />
        ))}
      </ol>
      {!meInTop && mine && (
        <>
          <div className="my-2 text-center text-xs text-muted">···</div>
          <RankRow row={mine} isMe />
        </>
      )}
      <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-brand-50 p-3 text-xs leading-relaxed text-brand-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Simulados no <b>modo prova</b> valem <b>3×</b> mais pontos que treinos. Questões criadas por você valem metade.
        </span>
      </p>
    </Card>
  )
}

function RankRow({ row, isMe }: { row: (typeof RANKING)[number] & { pos: number }; isMe: boolean }) {
  return (
    <li
      className={clsx(
        'flex items-center gap-3 rounded-xl px-2 py-2',
        isMe ? 'bg-brand-600 text-white' : row.pos <= 3 ? 'bg-gold-50' : 'hover:bg-brand-50',
      )}
    >
      <span className={clsx('w-6 text-center font-display text-sm font-extrabold', !isMe && row.pos <= 3 && 'text-gold-600')}>
        {row.pos === 1 ? <Crown size={16} className="mx-auto" /> : row.pos}
      </span>
      <Avatar seed={row.avatarSeed} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{isMe ? 'Você' : row.name}</span>
        <span className={clsx('block truncate text-[11px]', isMe ? 'text-brand-100' : 'text-muted')}>
          nota {row.grade.toFixed(1)} · {row.institution}
        </span>
      </span>
      <span className="text-right font-display text-sm font-bold tabular-nums">{row.points.toLocaleString('pt-BR')}</span>
    </li>
  )
}
