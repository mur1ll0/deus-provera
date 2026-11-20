import clsx from 'clsx'
import { ArrowRight, Clock, Flame, FileUp, Gauge, Medal, Target, Timer, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import { RankingPanel } from '@/components/RankingPanel'
import { Badge, Button, Card, ProgressRing } from '@/components/ui'
import { formatDate, pct } from '@/lib/format'
import { ACTIVITY_28D, MY_HISTORY, RANKING, TOPIC_PERFORMANCE } from '@/mocks/data'
import { useAuth } from '@/app/auth-context'
import { useStore } from '@/mocks/store'

export function DashboardPage() {
  const { me, questions } = useStore()
  const { user, profile } = useAuth()
  const myRank = [...RANKING].sort((a, b) => b.points - a.points).findIndex((r) => r.userId === me.id) + 1
  const mine = RANKING.find((r) => r.userId === me.id)!
  const myQuestions = questions.filter((q) => q.ownerId === me.id).length
  const totalAnswered = MY_HISTORY.reduce((a, h) => a + h.questions, 0)
  const avgAccuracy = MY_HISTORY.reduce((a, h) => a + h.accuracy * h.questions, 0) / totalAnswered
  const totalMin = MY_HISTORY.reduce((a, h) => a + h.timeMin, 0)
  const avgSecPerQuestion = Math.round((totalMin * 60) / totalAnswered)
  const provas = MY_HISTORY.filter((h) => h.mode === 'prova').length
  const weakest = [...TOPIC_PERFORMANCE].sort((a, b) => a.accuracy - b.accuracy)[0]

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
        {/* Hero */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-gold-50 p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-brand-100/60 blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Bom estudo, {(profile?.displayName || user?.name || me.name).split(' ')[0]}</p>
              <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">Estude como a prova cobra.</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Seu ponto mais fraco agora é <b className="text-ink">{weakest.topic}</b> ({pct(weakest.accuracy)} de acerto). Que tal um treino focado de 10 questões?
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/simulados">
                  <Button size="lg">
                    <Timer size={18} /> Novo simulado
                  </Button>
                </Link>
                <Link to="/importar">
                  <Button size="lg" variant="secondary">
                    <FileUp size={18} /> Importar questões
                  </Button>
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-2xl bg-white/80 p-4 shadow-sm">
              <ProgressRing value={mine.grade / 10} label={mine.grade.toFixed(1)} size={96} />
              <div>
                <p className="font-display text-sm font-bold">Nota de desempenho</p>
                <p className="text-xs text-muted">últimos 30 dias · 0 a 10</p>
                <Badge tone="green" className="mt-2">
                  <TrendingUp size={12} /> +0,4 na semana
                </Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <Kpi icon={Medal} label="Pontuação" value={mine.points.toLocaleString('pt-BR')} sub={`${myRank}º no ranking`} accent />
          <Kpi icon={Target} label="Acerto médio" value={pct(avgAccuracy)} sub={`${totalAnswered} questões`} />
          <Kpi icon={Gauge} label="Simulados feitos" value={String(mine.simulados)} sub={`${provas} provas nesta quinzena`} />
          <Kpi icon={Clock} label="Tempo por questão" value={`${Math.floor(avgSecPerQuestion / 60)}m${String(avgSecPerQuestion % 60).padStart(2, '0')}s`} sub="média recente" />
          <Kpi icon={Flame} label="Sequência" value="6 dias" sub="recorde: 11" />
          <Kpi icon={FileUp} label="Minhas questões" value={String(myQuestions)} sub="no seu banco" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Desempenho por assunto */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Mapa de desempenho</h2>
              <span className="text-xs text-muted">% de acerto por assunto</span>
            </div>
            <ul className="space-y-3">
              {TOPIC_PERFORMANCE.map((t) => (
                <li key={t.topic}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-bold">
                      {t.topic} <span className="font-normal text-muted">· {t.discipline}</span>
                    </span>
                    <span className="font-display font-bold tabular-nums">{pct(t.accuracy)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-brand-50">
                    <div
                      className={clsx('h-full rounded-full', t.accuracy >= 0.75 ? 'bg-emerald-500' : t.accuracy >= 0.6 ? 'bg-gold-400' : 'bg-rose-500')}
                      style={{ width: pct(t.accuracy) }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/simulados" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:underline">
              Treinar pontos fracos <ArrowRight size={14} />
            </Link>
          </Card>

          {/* Atividade + evolução */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Últimas 4 semanas</h2>
              <span className="text-xs text-muted">{ACTIVITY_28D.reduce((a, b) => a + b, 0)} questões</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {ACTIVITY_28D.map((n, i) => (
                <div
                  key={i}
                  title={`${n} questões`}
                  className={clsx(
                    'aspect-square rounded-md',
                    n === 0 ? 'bg-slate-100' : n < 8 ? 'bg-brand-200' : n < 16 ? 'bg-brand-400' : 'bg-brand-600',
                  )}
                />
              ))}
            </div>
            <h3 className="mb-3 mt-6 text-sm font-bold">Evolução do acerto (últimos simulados)</h3>
            <div className="flex h-28 items-end gap-2">
              {[...MY_HISTORY].reverse().map((h) => (
                <div key={h.id} className="flex flex-1 flex-col items-center gap-1" title={`${h.title}: ${pct(h.accuracy)}`}>
                  <span className="text-[10px] font-bold text-muted">{pct(h.accuracy)}</span>
                  <div className={clsx('w-full rounded-t-md', h.mode === 'prova' ? 'bg-brand-600' : 'bg-brand-300')} style={{ height: `${h.accuracy * 80}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <i className="size-2.5 rounded-sm bg-brand-600" /> prova
              </span>
              <span className="flex items-center gap-1">
                <i className="size-2.5 rounded-sm bg-brand-300" /> treino
              </span>
            </div>
          </Card>
        </div>

        {/* Últimos simulados */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Últimos simulados</h2>
            <Link to="/simulados" className="text-xs font-bold text-brand-600 hover:underline">
              ver todos
            </Link>
          </div>
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">Simulado</th>
                  <th className="font-bold">Modo</th>
                  <th className="font-bold">Questões</th>
                  <th className="font-bold">Acerto</th>
                  <th className="font-bold">Tempo</th>
                  <th className="text-right font-bold">Pontos</th>
                </tr>
              </thead>
              <tbody>
                {MY_HISTORY.slice(0, 5).map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className="py-2.5">
                      <p className="font-bold">{h.title}</p>
                      <p className="text-xs text-muted">{formatDate(h.date)}</p>
                    </td>
                    <td>
                      <Badge tone={h.mode === 'prova' ? 'brand' : 'neutral'}>{h.mode === 'prova' ? 'Prova' : 'Treino'}</Badge>
                    </td>
                    <td className="tabular-nums">{h.questions}</td>
                    <td className="font-bold tabular-nums">{pct(h.accuracy)}</td>
                    <td className="tabular-nums">{h.timeMin} min</td>
                    <td className="text-right font-display font-bold tabular-nums text-brand-700">+{h.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Painel direito: ranking */}
      <aside className="xl:sticky xl:top-8 xl:self-start">
        <RankingPanel />
      </aside>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, accent }: { icon: typeof Medal; label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <Card className={clsx('p-4', accent && 'border-brand-200 bg-brand-600 text-white')}>
      <Icon size={18} className={accent ? 'text-gold-400' : 'text-brand-500'} />
      <p className="mt-2 font-display text-2xl font-extrabold tabular-nums">{value}</p>
      <p className={clsx('text-xs font-bold', accent ? 'text-white' : 'text-ink')}>{label}</p>
      <p className={clsx('text-[11px]', accent ? 'text-brand-100' : 'text-muted')}>{sub}</p>
    </Card>
  )
}
