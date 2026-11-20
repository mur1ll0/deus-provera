import clsx from 'clsx'
import { Crown, Medal } from 'lucide-react'
import { RankingPanel } from '@/components/RankingPanel'
import { Avatar, Card, PageHeader } from '@/components/ui'
import { RANKING } from '@/mocks/data'
import { useStore } from '@/mocks/store'

export function RankingPage() {
  const { me } = useStore()
  const rows = [...RANKING].sort((a, b) => b.points - a.points)
  const podium = [rows[1], rows[0], rows[2]]

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Ranking" title="Quem mais pontuou" description="Pontos vêm dos simulados: prova vale 3× mais que treino. A nota (0–10) é sua acurácia ponderada dos últimos 30 dias." />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* Pódio */}
          <div className="grid grid-cols-3 items-end gap-3">
            {podium.map((r, i) => {
              const place = i === 1 ? 1 : i === 0 ? 2 : 3
              return (
                <Card key={r.userId} className={clsx('flex flex-col items-center p-4 text-center', place === 1 && 'border-gold-300 bg-gold-50 pb-8')}>
                  {place === 1 ? <Crown className="mb-1 text-gold-600" /> : <Medal className={clsx('mb-1', place === 2 ? 'text-slate-400' : 'text-orange-400')} />}
                  <Avatar seed={r.avatarSeed} size="lg" highlight={r.userId === me.id} />
                  <p className="mt-2 truncate text-sm font-bold">{r.userId === me.id ? 'Você' : r.name}</p>
                  <p className="font-display text-lg font-extrabold">{r.points.toLocaleString('pt-BR')}</p>
                  <p className="text-[11px] text-muted">nota {r.grade.toFixed(1)}</p>
                </Card>
              )
            })}
          </div>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
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
                {rows.map((r, i) => (
                  <tr key={r.userId} className={clsx('border-t border-line', r.userId === me.id && 'bg-brand-600 text-white')}>
                    <td className="px-4 py-3 font-display font-bold">{i + 1}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar seed={r.avatarSeed} size="sm" />
                        <div>
                          <p className="font-bold">{r.userId === me.id ? 'Você' : r.name}</p>
                          <p className={clsx('text-[11px]', r.userId === me.id ? 'text-brand-100' : 'text-muted')}>{r.institution}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell">{r.simulados}</td>
                    <td className="font-bold">{r.grade.toFixed(1)}</td>
                    <td className="px-4 text-right font-display font-bold tabular-nums">{r.points.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <RankingPanel limit={5} />
        </aside>
      </div>
    </div>
  )
}
