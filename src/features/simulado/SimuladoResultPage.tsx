import clsx from 'clsx'
import { Award, BrainCircuit, Check, ChevronDown, Clock, Hourglass, Minus, RotateCcw, Sparkles, Target, Timer, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { AnswerKind, ItemAnswer, Question, QuestionItem, SimuladoAttempt } from '@shared/domain'
import { GRADER_WEIGHT, MODE_MULTIPLIER } from '@shared/scoring'
import { presentAs } from '@shared/simulado'
import { Badge, Button, Card, DemoTag, EmptyState, PageHeader, ProgressRing } from '@/components/ui'
import { formatDuration, LETTERS, pct } from '@/lib/format'
import { aiExplain, aiGradeDiscursive, type AiExplanation } from '@/mocks/ai'
import { useStore } from '@/mocks/store'
import { computeAttemptScore } from './scoringAdapter'

export function SimuladoResultPage() {
  const { id } = useParams()
  const store = useStore()
  const navigate = useNavigate()
  const attempt = store.attempts.find((a) => a.id === id)
  const byId = useMemo(() => new Map(store.questions.map((q) => [q.id, q])), [store.questions])
  const [open, setOpen] = useState<string | null>(null)

  if (!attempt || !attempt.finishedAt)
    return (
      <EmptyState icon={<Timer />} title="Resultado indisponível">
        <Link className="font-bold text-brand-600" to="/simulados">
          Voltar aos simulados
        </Link>
      </EmptyState>
    )

  const qs = attempt.questionIds.map((qid) => byId.get(qid)).filter(Boolean) as Question[]
  const score = computeAttemptScore(attempt, byId, store.me.id)
  const ans = (it: QuestionItem): ItemAnswer => attempt.answers[it.id] ?? { itemId: it.id, score: 0 }
  const allItems = qs.flatMap((q) => q.items)
  const pending = allItems.filter((it) => ans(it).score == null)
  const correctItems = allItems.filter((it) => (ans(it).score ?? 0) >= 0.5).length
  const timeOf = (q: Question) => attempt.timeMs?.[q.id] ?? 0
  const avgTime = attempt.totalTimeMs / Math.max(1, qs.length)
  const maxTime = Math.max(...qs.map(timeOf), 1)
  const slowest = [...qs].sort((a, b) => timeOf(b) - timeOf(a))[0]
  const qScore = (q: Question) => q.items.reduce((s, it) => s + (ans(it).score ?? 0), 0) / q.items.length

  const byTopic = new Map<string, { n: number; s: number }>()
  for (const q of qs) {
    const k = store.disciplineName(q.disciplineId) + (q.topic ? ` · ${q.topic}` : '')
    const cur = byTopic.get(k) ?? { n: 0, s: 0 }
    byTopic.set(k, { n: cur.n + q.items.length, s: cur.s + q.items.reduce((s, it) => s + (ans(it).score ?? 0), 0) })
  }

  function grade(it: QuestionItem, patch: Partial<ItemAnswer>) {
    const next: SimuladoAttempt = { ...attempt!, answers: { ...attempt!.answers, [it.id]: { ...ans(it), ...patch } } }
    store.saveAttempt({ ...next, points: computeAttemptScore(next, byId, store.me.id).total })
  }

  function retryWrong() {
    const wrong = qs.filter((q) => qScore(q) < 0.5)
    const created = store.startSimulado({
      ...attempt!.config,
      mode: 'treino',
      reveal: 'imediato',
      aiHints: true,
      timeLimitMin: null,
      areaId: null,
      disciplineIds: [],
      topics: [...new Set(wrong.map((q) => q.topic).filter(Boolean) as string[])],
      count: Math.max(1, wrong.length),
    })
    if (created) navigate(`/simulados/${created.id}`)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={`Resultado · ${attempt.config.mode === 'prova' ? 'Prova' : 'Treino'}`}
        title={score.accuracy >= 0.7 ? 'Mandou bem!' : score.accuracy >= 0.5 ? 'Bom caminho — revise os erros' : 'Hora de revisar'}
        actions={
          <>
            <Button variant="secondary" onClick={retryWrong} disabled={correctItems === allItems.length}>
              <RotateCcw size={16} /> Treinar o que errei
            </Button>
            <Link to="/simulados">
              <Button>Novo simulado</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Card className="flex items-center gap-5 p-5">
          <ProgressRing value={score.accuracy} size={110} stroke={11} />
          <div>
            <p className="font-display text-3xl font-extrabold text-brand-700">+{score.total} pts</p>
            <p className="text-xs text-muted">
              base {score.base} {score.timeBonus > 0 && `+ bônus de tempo ${score.timeBonus}`} · ×{MODE_MULTIPLIER[attempt.config.mode]} modo {attempt.config.mode}
            </p>
            <Badge tone={score.countsForRanking ? 'green' : 'neutral'} className="mt-2">
              {score.countsForRanking ? 'Conta para o ranking' : 'Não conta para o ranking'}
            </Badge>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini icon={Target} label="Perguntas certas" value={`${correctItems}/${allItems.length}`} />
          <Mini icon={Clock} label="Tempo total" value={formatDuration(attempt.totalTimeMs)} />
          <Mini icon={Hourglass} label="Média/questão" value={formatDuration(avgTime)} />
          <Mini icon={Award} label="Mais demorada" value={slowest ? `Q${qs.indexOf(slowest) + 1} · ${formatDuration(timeOf(slowest))}` : '—'} />
        </div>
      </div>

      {pending.length > 0 && (
        <p className="mt-4 rounded-xl border border-gold-300 bg-gold-50 p-3 text-sm text-gold-600">
          <b>{pending.length} pergunta(s) discursiva(s) aguardando correção.</b> Corrija pelos pontos de acerto (vale {GRADER_WEIGHT.checklist * 100}% dos pontos) ou com a IA (100%). A pontuação é atualizada na hora.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="min-w-0 p-2 sm:p-4">
          <h2 className="px-2 pb-2 pt-1 font-bold">Gabarito</h2>
          <ul className="divide-y divide-line">
            {qs.map((q, i) => {
              const s = qScore(q)
              const isPending = q.items.some((it) => ans(it).score == null)
              const status = isPending ? 'pending' : s === 1 ? 'ok' : s >= 0.5 ? 'partial' : s > 0 ? 'partial' : 'wrong'
              const isOpen = open === q.id
              return (
                <li key={q.id}>
                  <button onClick={() => setOpen(isOpen ? null : q.id)} className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-brand-50/50">
                    <StatusDot status={status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {i + 1}. {q.stem}
                      </span>
                      <span className="block text-xs text-muted">
                        {q.items.length > 1 ? `${q.items.length} perguntas · ` : ''}
                        {isPending ? 'aguardando correção' : `${Math.round(s * 100)}% de acerto`}
                      </span>
                    </span>
                    <span className="hidden w-28 sm:block" title="Tempo na questão">
                      <span className="block text-right text-xs tabular-nums text-muted">{formatDuration(timeOf(q))}</span>
                      <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-brand-400" style={{ width: `${(timeOf(q) / maxTime) * 100}%` }} />
                      </span>
                    </span>
                    <ChevronDown size={16} className={clsx('shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="space-y-4 px-2 pb-4 text-sm sm:pl-13">
                      <p className="whitespace-pre-line rounded-xl bg-brand-50/60 p-3">{q.stem}</p>
                      {q.items.map((it, j) => (
                        <ItemReview key={it.id} item={it} index={j} multi={q.items.length > 1} topic={q.topic} kind={presentAs(it, attempt.config.answerFormat)} a={ans(it)} onGrade={(p) => grade(it, p)} />
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>

        <aside className="min-w-0 space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-bold">Por assunto</h2>
            <ul className="space-y-3">
              {[...byTopic.entries()].map(([k, v]) => (
                <li key={k}>
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span className="font-bold">{k}</span>
                    <span className="tabular-nums">{pct(v.s / v.n)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-brand-50">
                    <div className={clsx('h-full rounded-full', v.s / v.n >= 0.7 ? 'bg-emerald-500' : v.s / v.n >= 0.5 ? 'bg-gold-400' : 'bg-rose-500')} style={{ width: pct(v.s / v.n) }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-2 font-bold">Como a pontuação foi calculada</h2>
            <ul className="space-y-1 text-xs text-muted">
              <li>Cada pergunta pontua: fácil 10 · média 15 · difícil 20</li>
              <li>Prova ×3 · Treino ×1</li>
              <li>Questões suas valem 50%</li>
              <li>Dica usada antes de responder: 50%</li>
              <li>Autocorreção de discursiva: 50% · IA: 100%</li>
              <li>Prova: bônus de até 20% pelo tempo que sobrou</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: 'ok' | 'partial' | 'wrong' | 'pending' }) {
  return (
    <span
      className={clsx(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        status === 'ok' && 'bg-emerald-100 text-emerald-700',
        status === 'wrong' && 'bg-rose-100 text-rose-700',
        status === 'partial' && 'bg-gold-100 text-gold-600',
        status === 'pending' && 'bg-slate-100 text-muted',
      )}
    >
      {status === 'ok' ? <Check size={16} /> : status === 'wrong' ? <X size={16} /> : <Minus size={16} />}
    </span>
  )
}

function Mini({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <Card className="p-4">
      <Icon size={16} className="text-brand-500" />
      <p className="mt-1 font-display text-lg font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </Card>
  )
}

function ItemReview({
  item,
  index,
  multi,
  topic,
  kind,
  a,
  onGrade,
}: {
  item: QuestionItem
  index: number
  multi: boolean
  topic?: string
  kind: AnswerKind
  a: ItemAnswer
  onGrade: (p: Partial<ItemAnswer>) => void
}) {
  const [ai, setAi] = useState<AiExplanation | null>(null)
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState<boolean[]>((item.keyPoints ?? []).map(() => false))
  const alts = item.alternatives ?? []
  const status = a.score == null ? 'pending' : a.score >= 0.5 ? 'ok' : a.score > 0 ? 'partial' : 'wrong'

  return (
    <div className={clsx(multi && 'rounded-xl border border-line p-3')}>
      {multi && (
        <p className="mb-2 flex items-start gap-2 font-bold">
          <StatusDot status={status} />
          <span className="pt-1">
            {item.label ?? index + 1}) {item.prompt}
          </span>
        </p>
      )}
      {kind === 'objetiva' ? (
        <>
          <ul className="space-y-1.5">
            {alts.map((x, i) => {
              const why = ai?.perAlternative.find((p) => p.id === x.id)?.why ?? x.explanation
              return (
                <li key={x.id} className={clsx('rounded-xl border p-2.5', x.correct ? 'border-emerald-300 bg-emerald-50' : x.id === a.choiceId ? 'border-rose-300 bg-rose-50' : 'border-line')}>
                  <b>{LETTERS[i]})</b> {x.text}
                  {x.id === a.choiceId && (
                    <Badge tone={x.correct ? 'green' : 'red'} className="ml-2">
                      sua resposta
                    </Badge>
                  )}
                  {why && <span className="mt-0.5 block text-xs text-muted">{why}</span>}
                </li>
              )
            })}
          </ul>
          {!a.choiceId && <p className="mt-1 text-xs text-rose-600">Em branco.</p>}
          {!ai && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={loading}
              onClick={async () => {
                setLoading(true)
                setAi(await aiExplain(item, topic))
                setLoading(false)
              }}
            >
              <BrainCircuit size={14} /> {loading ? 'Gerando…' : 'Explicar alternativas com IA'} <DemoTag />
            </Button>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-xs font-bold uppercase text-muted">Sua resposta</p>
            <p className="mt-1 whitespace-pre-line">{a.text?.trim() || <i className="text-muted">em branco</i>}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
            <p className="text-xs font-bold uppercase text-emerald-700">Resposta esperada</p>
            <p className="mt-1 whitespace-pre-line">{item.expectedAnswer}</p>
            {(item.keyPoints?.length ?? 0) > 0 && (
              <>
                <p className="mt-3 text-xs font-bold uppercase text-emerald-700">Pontos de acerto</p>
                <ul className="mt-1 space-y-1">
                  {item.keyPoints!.map((kp, i) => (
                    <li key={kp}>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-emerald-600"
                          disabled={a.score != null}
                          checked={checked[i] ?? false}
                          onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                        />
                        {kp}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {a.score == null ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onGrade({ score: checked.filter(Boolean).length / Math.max(1, checked.length), gradedBy: 'checklist' })}>
                  Confirmar autocorreção
                </Button>
                <Button
                  size="sm"
                  variant="gold"
                  disabled={loading || !a.text?.trim()}
                  onClick={async () => {
                    setLoading(true)
                    const r = await aiGradeDiscursive(a.text ?? '', item.keyPoints ?? [])
                    setChecked(r.matched)
                    onGrade({ score: r.score, gradedBy: 'ia' })
                    setLoading(false)
                  }}
                >
                  <Sparkles size={14} /> {loading ? 'Corrigindo…' : 'Corrigir com IA'} <DemoTag />
                </Button>
              </div>
            ) : (
              <p className="mt-2 font-display text-sm font-bold text-emerald-700">
                Nota: {Math.round(a.score * 100)}% {a.gradedBy === 'ia' ? '(IA)' : a.gradedBy === 'checklist' ? '(autocorreção)' : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
