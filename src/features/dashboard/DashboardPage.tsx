import clsx from 'clsx'
import { ArrowRight, Clock, Flame, FileUp, Gauge, Medal, Target, Timer, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import { MIN_ANSWERS_FOR_WEAKEST } from '@shared/stats'
import { RankingPanel } from '@/components/RankingPanel'
import { Badge, Button, Card, EmptyState, ProgressRing } from '@/components/ui'
import { FullScreen } from '@/app/RequireAuth'
import { blessingOfTheDay } from '@/lib/blessings'
import { formatDate, pct } from '@/lib/format'
import { useAuth } from '@/app/auth-context'
import { useDashboardData } from './data'

export function DashboardPage() {
  const { user, profile } = useAuth()
  const { data: d, loading, error } = useDashboardData()
  if (loading) return <FullScreen>Carregando seu painel…</FullScreen>
  if (error || !d) return <EmptyState icon={<Gauge />} title="Não foi possível carregar o painel">{error}</EmptyState>
  const empty = d.simulados === 0
  const weakest = d.weakest
  const avgSec = d.avgSecPerQuestion
  const firstName = (profile?.displayName || user?.name || '').split(' ')[0]
  const blessing = blessingOfTheDay()

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
        {/* Hero */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-gold-50 p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-brand-100/60 blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Estudos abençoados{firstName ? `, ${firstName}` : ''}</p>
              <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{blessing.text}</h1>
              {blessing.ref && <p className="mt-1 text-sm font-bold text-gold-600">{blessing.ref}</p>}
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {weakest ? (
                  <>
                    Seu ponto mais fraco agora é <b className="text-ink">{weakest.topic}</b> ({pct(weakest.accuracy)} de acerto). Que tal um treino focado de 10 questões?
                  </>
                ) : empty ? (
                  'Importe suas listas ou cadastre questões e faça o primeiro simulado: suas estatísticas aparecem aqui.'
                ) : (
                  `Continue respondendo: com ${MIN_ANSWERS_FOR_WEAKEST} respostas num assunto, mostramos aqui seu ponto mais fraco.`
                )}
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
              <ProgressRing value={(d.grade ?? 0) / 10} label={d.grade != null ? d.grade.toFixed(1) : '—'} size={96} />
              <div>
                <p className="font-display text-sm font-bold">Nota de desempenho</p>
                <p className="text-xs text-muted">{d.grade != null ? 'últimos 30 dias · 0 a 10' : 'aparece com 10 respostas corrigidas'}</p>
                {d.gradeDelta != null && d.gradeDelta !== 0 && (
                  <Badge tone={d.gradeDelta > 0 ? 'green' : 'red'} className="mt-2">
                    <TrendingUp size={12} /> {d.gradeDelta > 0 ? '+' : ''}
                    {d.gradeDelta.toFixed(1).replace('.', ',')} na semana
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <Kpi icon={Medal} label="Pontuação" value={d.points.toLocaleString('pt-BR')} sub={d.rank ? `${d.rank}º no ranking` : 'sem pontos ainda'} accent />
          <Kpi icon={Target} label="Acerto médio" value={d.accuracy != null ? pct(d.accuracy) : '—'} sub={`${d.answered} perguntas`} />
          <Kpi icon={Gauge} label="Simulados feitos" value={String(d.simulados)} sub={`${d.provas14d} provas nesta quinzena`} />
          <Kpi icon={Clock} label="Tempo por questão" value={avgSec != null ? `${Math.floor(avgSec / 60)}m${String(avgSec % 60).padStart(2, '0')}s` : '—'} sub="média dos simulados" />
          <Kpi icon={Flame} label="Sequência" value={`${d.streak.current} ${d.streak.current === 1 ? 'dia' : 'dias'}`} sub={`recorde: ${d.streak.best}`} />
          <Kpi icon={FileUp} label="Minhas questões" value={String(d.myQuestions)} sub="no seu banco" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Desempenho por assunto */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Mapa de desempenho</h2>
              <span className="text-xs text-muted">% de acerto por assunto</span>
            </div>
            {d.topics.length === 0 && <p className="text-sm text-muted">Sem respostas corrigidas ainda.</p>}
            <ul className="space-y-3">
              {d.topics.map((t) => (
                <li key={`${t.discipline}|${t.topic}`}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="min-w-0 font-bold">
                      {t.topic} <span className="font-normal text-muted">· {t.discipline}</span>
                    </span>
                    <span className="shrink-0 pl-2 text-right">
                      <span className="mr-2 text-xs text-muted tabular-nums">
                        {t.answered} {t.answered === 1 ? 'resposta' : 'respostas'}
                      </span>
                      <span className="font-display font-bold tabular-nums">{pct(t.accuracy)}</span>
                    </span>
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
            <Link
              to={weakest ? `/simulados?assunto=${encodeURIComponent(weakest.topic)}` : '/simulados'}
              className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:underline"
            >
              Treinar pontos fracos <ArrowRight size={14} />
            </Link>
          </Card>

          {/* Atividade + evolução */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Últimas 4 semanas</h2>
              <span className="text-xs text-muted">{d.activity.reduce((a, b) => a + b.count, 0)} perguntas</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5" role="img" aria-label={`Atividade dos últimos 28 dias: ${d.activity.filter((x) => x.count > 0).length} dias com estudo`}>
              {d.activity.map(({ day, count: n }, i) => (
                <div
                  key={i}
                  title={`${day}: ${n} perguntas`}
                  className={clsx(
                    'aspect-square rounded-md',
                    n === 0 ? 'bg-slate-100' : n < 8 ? 'bg-brand-200' : n < 16 ? 'bg-brand-400' : 'bg-brand-600',
                  )}
                />
              ))}
            </div>
            <h3 className="mb-3 mt-6 text-sm font-bold">Evolução do acerto (últimos simulados)</h3>
            <div className="flex h-28 items-end gap-2">
              {d.history.length === 0 && <p className="text-sm text-muted">Nenhum simulado finalizado ainda.</p>}
              {[...d.history].reverse().map((h) => (
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
                {d.history.slice(0, 5).map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className="py-2.5">
                      <p className="font-bold">{h.href ? <Link to={h.href} className="hover:underline">{h.title}</Link> : h.title}</p>
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
