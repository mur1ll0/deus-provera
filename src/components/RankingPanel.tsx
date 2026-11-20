import clsx from 'clsx'
import { Crown, Info, Trophy } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useRankingData, type Period, type RankRow as Row } from '@/features/dashboard/data'
import { Avatar, Card, Segmented } from './ui'

export function RankingPanel({ limit = 8, className, period: controlled, onPeriod }: { limit?: number; className?: string; period?: Period; onPeriod?: (p: Period) => void }) {
  const [own, setOwn] = useState<Period>('semana')
  const period = controlled ?? own
  const setPeriod = onPeriod ?? setOwn
  const { rows, me: mine, loading, error } = useRankingData(period)
  const top = rows.slice(0, limit)
  const meInTop = top.some((r) => r.me)

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
      {loading && <p className="py-4 text-center text-sm text-muted">Carregando…</p>}
      {error && <p className="py-4 text-center text-sm text-rose-600">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="py-4 text-center text-sm text-muted">Ninguém pontuou neste período ainda. Faça um simulado e seja o primeiro!</p>}
      <ol className="space-y-1">
        {top.map((r) => (
          <RankRow key={r.userId} row={r} isMe={r.me} />
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

function RankRow({ row, isMe }: { row: Row; isMe: boolean }) {
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
      <Avatar seed={row.avatarSeed} src={row.image} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{isMe ? 'Você' : row.name}</span>
        <span className={clsx('block truncate text-[11px]', isMe ? 'text-brand-100' : 'text-muted')}>
          {row.grade != null ? `nota ${row.grade.toFixed(1)}` : `${row.simulados} simulados`}
          {row.institution ? ` · ${row.institution}` : ''}
        </span>
      </span>
      <span className="text-right font-display text-sm font-bold tabular-nums">{row.points.toLocaleString('pt-BR')}</span>
    </li>
  )
}
