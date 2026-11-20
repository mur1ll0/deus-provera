import clsx from 'clsx'
import { Crown, Medal, Trophy } from 'lucide-react'
import { useState } from 'react'
import { RankingPanel } from '@/components/RankingPanel'
import { Avatar, Card, EmptyState, PageHeader, Segmented } from '@/components/ui'
import { useRankingData, type Period } from '@/features/dashboard/data'

export function RankingPage() {
  const [period, setPeriod] = useState<Period>('geral')
  const { rows, me, loading, error } = useRankingData(period)
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean)
  const list = me && !rows.some((r) => r.me) ? [...rows, me] : rows

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Ranking" title="Quem mais pontuou" description="Pontos vêm dos simulados: prova vale 3× mais que treino. A nota (0–10) é sua acurácia ponderada dos últimos 30 dias." />

      <Segmented
        value={period}
        onChange={setPeriod}
        className="mb-5"
        options={[
          { value: 'semana', label: 'Semana' },
          { value: 'mes', label: 'Mês' },
          { value: 'geral', label: 'Geral' },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <EmptyState icon={<Trophy />} title="Ninguém pontuou neste período ainda">
              Faça um simulado no modo prova (vale 3×) e apareça aqui.
            </EmptyState>
          )}
          {/* Pódio */}
          {rows.length >= 3 && (
          <div className="grid grid-cols-3 items-end gap-3">
            {podium.map((r) => {
              const place = r.pos
              return (
                <Card key={r.userId} className={clsx('flex flex-col items-center p-4 text-center', place === 1 && 'border-gold-300 bg-gold-50 pb-8')}>
                  {place === 1 ? <Crown className="mb-1 text-gold-600" /> : <Medal className={clsx('mb-1', place === 2 ? 'text-slate-400' : 'text-orange-400')} />}
                  <Avatar seed={r.avatarSeed} src={r.image} size="lg" highlight={r.me} />
                  <p className="mt-2 w-full truncate text-sm font-bold">{r.me ? 'Você' : r.name}</p>
                  <p className="font-display text-lg font-extrabold">{r.points.toLocaleString('pt-BR')}</p>
                  <p className="text-[11px] text-muted">{r.grade != null ? `nota ${r.grade.toFixed(1)}` : `${r.simulados} simulados`}</p>
                </Card>
              )
            })}
          </div>
          )}

          {list.length > 0 && (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">Ranking por pontos no período</caption>
              <thead className="bg-brand-50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th>Estudante</th>
                  <th className="hidden sm:table-cell">Simulados</th>
                  <th>Nota</th>
                  <th className="px-4 text-right">Pontos</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.userId} className={clsx('border-t border-line', r.me && 'bg-brand-600 text-white')}>
                    <td className="px-4 py-3 font-display font-bold">{r.pos}</td>
                    <td>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar seed={r.avatarSeed} src={r.image} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-bold">{r.me ? 'Você' : r.name}</p>
                          <p className={clsx('truncate text-[11px]', r.me ? 'text-brand-100' : 'text-muted')}>{r.institution}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell">{r.simulados}</td>
                    <td className="font-bold">{r.grade != null ? r.grade.toFixed(1) : '—'}</td>
                    <td className="px-4 text-right font-display font-bold tabular-nums">{r.points.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          )}
        </div>
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <RankingPanel limit={5} period={period} onPeriod={setPeriod} />
        </aside>
      </div>
    </div>
  )
}
