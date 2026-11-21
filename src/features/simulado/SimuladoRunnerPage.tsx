import clsx from 'clsx'
import { BrainCircuit, Check, ChevronLeft, ChevronRight, Clock, Flag, ImageIcon, Lightbulb, Scissors, Sparkles, Timer, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import type { AnswerKind, ItemAnswer, Question, QuestionItem, SimuladoAttempt } from '@shared/domain'
import { itemMarker } from '@shared/item-label'
import { useAuth } from '@/app/auth-context'
import { FullScreen } from '@/app/RequireAuth'
import { Logo } from '@/components/Logo'
import { Badge, Button, Card, DemoTag, EmptyState, inputClass, Modal } from '@/components/ui'
import { RichText } from '@/components/RichText'
import { formatDuration, LETTERS } from '@/lib/format'
import type { AiExplanation } from '@/mocks/ai'
import { itemLabel } from '@/mocks/model'
import { useStore } from '@/mocks/store'
import { ApiError } from '@/lib/api'
import { fetchAttempt, kindsOf, toAttempt, toQuestions } from './remote'
import { localBackend, remoteBackend, type RunnerBackend, type SaveStatus } from './runnerBackend'

export function SimuladoRunnerPage() {
  const { id = '' } = useParams()
  return useAuth().mode === 'real' ? <RemoteRunner id={id} /> : <LocalRunner id={id} />
}

const notFound = (
  <div className="p-8">
    <EmptyState icon={<Timer />} title="Simulado não encontrado">
      <Link className="font-bold text-brand-600" to="/simulados">
        Voltar aos simulados
      </Link>
    </EmptyState>
  </div>
)

/** API real (spec 003): estado no servidor — retoma ao recarregar (T021). */
function RemoteRunner({ id }: { id: string }) {
  const { user } = useAuth()
  const q = useQuery({
    queryKey: ['simulado', id],
    // Diferença de relógio medida na chegada da resposta (o cronômetro segue o servidor).
    queryFn: async () => {
      const view = await fetchAttempt(id)
      return { view, offset: Date.parse(view.serverNow) - Date.now() }
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const ready = q.data?.view
  const offset = q.data?.offset ?? 0
  const backend = useMemo(
    () => (ready ? remoteBackend({ attemptId: ready.id, limitMs: ready.timeLimitMs, clockOffsetMs: offset, kinds: kindsOf(ready) }) : null),
    [ready, offset],
  )
  if (q.error instanceof ApiError && q.error.status === 409) return <Navigate to={`/simulados/${id}/resultado`} replace />
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? notFound : <FullScreen>{q.error.message}</FullScreen>
  if (!ready || !backend || !user) return <FullScreen>Carregando simulado…</FullScreen>
  return <Runner key={ready.id} attempt={toAttempt(ready, user.id)} questions={toQuestions(ready, user.id)} backend={backend} />
}

/** Protótipo sem API: store em memória. */
function LocalRunner({ id }: { id: string }) {
  const store = useStore()
  const attempt = store.attempts.find((a) => a.id === id)
  const byId = useMemo(() => new Map(store.questions.map((q) => [q.id, q])), [store.questions])
  const backend = useMemo(() => (attempt ? localBackend(attempt, store, byId) : null), [attempt?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!attempt)
    return (
      <div className="p-8">
        <EmptyState icon={<Timer />} title="Simulado não encontrado">
          <Link className="font-bold text-brand-600" to="/simulados">
            Voltar aos simulados
          </Link>
        </EmptyState>
      </div>
    )
  if (attempt.finishedAt) return <Navigate to={`/simulados/${attempt.id}/resultado`} replace />
  if (!attempt.questionIds.some((qid) => store.questions.some((q) => q.id === qid)))
    return (
      <div className="p-8">
        <EmptyState icon={<Timer />} title="As questões deste simulado não existem mais">
          <Link className="font-bold text-brand-600" to="/simulados">
            Montar outro simulado
          </Link>
        </EmptyState>
      </div>
    )
  const questions = attempt.questionIds.map((qid) => byId.get(qid)).filter(Boolean) as Question[]
  return <Runner key={attempt.id} attempt={attempt} questions={questions} backend={backend!} />
}

const blank = (itemId: string): ItemAnswer => ({ itemId, score: null })
const isAnswered = (a?: ItemAnswer) => Boolean(a?.choiceId || a?.text?.trim())

function Runner({ attempt, questions, backend }: { attempt: SimuladoAttempt; questions: Question[]; backend: RunnerBackend }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Perguntas cujo gabarito chega ao revelar (treino) são trocadas aqui.
  const [qs, setQs] = useState(questions)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('ok')
  const [finishError, setFinishError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  useEffect(() => backend.subscribe(setSaveStatus), [backend])
  const cfg = attempt.config
  const isProva = cfg.mode === 'prova'
  const revealNow = !isProva && cfg.reveal === 'imediato'

  const [idx, setIdx] = useState(0)
  const clock = useCallback(() => Date.now() + backend.clockOffsetMs, [backend])
  const [now, setNow] = useState(clock)
  const [confirmExit, setConfirmExit] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>(() => ({ ...attempt.answers }))
  const [timeMs, setTimeMs] = useState<Record<string, number>>(() => ({ ...(attempt.timeMs ?? {}) }))
  const [flagged, setFlagged] = useState<string[]>(() => attempt.flagged ?? [])
  /** Momento em que a questão atual foi aberta (cronômetro por questão). */
  const [qStart, setQStart] = useState(() => Date.now())
  const startedAt = useMemo(() => new Date(attempt.startedAt).getTime(), [attempt.startedAt])
  const finished = useRef(false)

  const q = qs[idx]
  /** Muda a resposta na tela; `persist` envia ao backend (escolha, texto, dica). */
  const update = useCallback(
    (itemId: string, patch: Partial<ItemAnswer>, persist = true) => {
      setAnswers((all) => ({ ...all, [itemId]: { ...(all[itemId] ?? blank(itemId)), ...patch } }))
      if (persist) backend.saveAnswer(itemId, patch)
    },
    [backend],
  )

  const reveal = useCallback(
    async (item: QuestionItem, checked?: boolean[]) => {
      const r = await backend.reveal(item, answers[item.id] ?? blank(item.id), checked)
      setQs((all) => all.map((x) => (x.items.some((it) => it.id === item.id) ? { ...x, items: x.items.map((it) => (it.id === item.id ? r.item : it)) } : x)))
      update(item.id, r.answer, false)
      return r.item
    },
    [backend, answers, update],
  )

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= qs.length || i === idx) return
      const at = Date.now()
      const curId = qs[idx].id
      const spent = at - qStart
      setTimeMs((t) => ({ ...t, [curId]: (t[curId] ?? 0) + spent }))
      backend.saveTime(curId, spent)
      setQStart(at)
      setIdx(i)
    },
    [qs, idx, qStart, backend],
  )

  const finish = useCallback(async () => {
    if (finished.current) return
    finished.current = true
    setFinishing(true)
    setFinishError(null)
    const at = Date.now()
    const curId = qs[idx].id
    const spent = at - qStart
    const finalTime = { ...timeMs, [curId]: (timeMs[curId] ?? 0) + spent }
    backend.saveTime(curId, spent)
    setQStart(at)
    try {
      await backend.finish({ answers, timeMs: finalTime, flagged, totalTimeMs: clock() - startedAt })
      void queryClient.invalidateQueries({ queryKey: ['simulados'] })
      navigate(`/simulados/${attempt.id}/resultado`, { replace: true })
    } catch (err) {
      finished.current = false
      setFinishing(false)
      setFinishError((err as Error).message || 'Não foi possível finalizar. Tente de novo.')
    }
  }, [attempt.id, answers, timeMs, flagged, qs, idx, qStart, startedAt, navigate, backend, clock, queryClient])

  // Cronômetro: atualiza a tela e, no fim do prazo, finaliza sozinho.
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])
  // Acessibilidade (T033): aviso falado aos 5 min e 1 min do fim; foco na questão ao navegar.
  const [announce, setAnnounce] = useState('')
  const warned = useRef(new Set<number>())
  useEffect(() => {
    const t = setInterval(() => {
      const at = clock()
      setNow(at)
      if (backend.limitMs === null) return
      const left = backend.limitMs - (at - startedAt)
      for (const min of [5, 1]) {
        if (left <= min * 60_000 && left > 0 && !warned.current.has(min)) {
          warned.current.add(min)
          setAnnounce(min === 1 ? 'Atenção: falta 1 minuto para o fim do simulado.' : 'Atenção: faltam 5 minutos para o fim do simulado.')
        }
      }
      if (left <= 0) void finishRef.current()
    }, 500)
    return () => clearInterval(t)
  }, [clock, backend, startedAt])
  const cardRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    cardRef.current?.focus()
  }, [idx])

  const elapsed = now - startedAt
  const limitMs = backend.limitMs
  const remaining = limitMs ? limitMs - elapsed : null
  const qElapsed = (timeMs[q.id] ?? 0) + Math.max(0, now - qStart)


  // Atalhos: ← → navegam; A–E respondem a primeira pergunta de múltipla escolha ainda sem resposta
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('textarea,input,select,[contenteditable]')) return
      if (e.key === 'ArrowRight') go(idx + 1)
      if (e.key === 'ArrowLeft') go(idx - 1)
      const li = LETTERS.indexOf(e.key.toUpperCase())
      if (li < 0) return
      const target = q.items.find((it) => backend.kindOf(it) === 'objetiva' && !(revealNow && answers[it.id]?.score != null) && !answers[it.id]?.choiceId)
      const alts = target?.alternatives ?? []
      if (target && li < alts.length) update(target.id, { choiceId: alts[li].id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, idx, q, backend, revealNow, answers, update])

  const totalItems = qs.reduce((a, x) => a + x.items.length, 0)
  const answeredItems = qs.reduce((a, x) => a + x.items.filter((it) => isAnswered(answers[it.id])).length, 0)
  const low = remaining !== null && remaining < 5 * 60_000
  const isFlagged = flagged.includes(q.id)

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <button onClick={() => setConfirmExit(true)} className="hidden sm:block" aria-label="Sair do simulado">
            <Logo compact />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600">Simulado · {isProva ? 'Prova' : 'Treino'}</p>
            <p className="font-display text-sm font-bold">
              Questão {idx + 1} de {qs.length}{' '}
              <span className="font-normal text-muted">
                · {answeredItems}/{totalItems} perguntas respondidas
              </span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={clsx('hidden text-xs sm:inline', saveStatus === 'error' ? 'font-bold text-rose-600' : 'text-muted')} aria-live="polite">
              {saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'error' ? 'Sem conexão — tentando de novo' : ''}
            </span>
            <span className="hidden items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 font-display text-sm font-bold tabular-nums sm:inline-flex" title="Tempo nesta questão">
              <Clock size={15} /> {formatDuration(qElapsed)}
            </span>
            <span
              className={clsx('inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-display text-sm font-bold tabular-nums', low ? 'animate-pulse bg-rose-100 text-rose-700' : 'bg-brand-50 text-brand-700')}
              title={remaining !== null ? 'Tempo restante' : 'Tempo total'}
              role="timer"
              aria-label={remaining !== null ? `Tempo restante: ${formatDuration(remaining)}` : `Tempo total: ${formatDuration(elapsed)}`}
            >
              <Timer size={15} /> {remaining !== null ? formatDuration(remaining) : formatDuration(elapsed)}
            </span>
            <Button size="sm" onClick={() => setConfirmFinish(true)}>
              Finalizar
            </Button>
          </div>
        </div>
        <div className="h-1 bg-brand-50">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${((idx + 1) / qs.length) * 100}%` }} />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_240px]">
        <main className="min-w-0">
          <p className="sr-only" aria-live="assertive">
            {announce}
          </p>
          <div ref={cardRef} tabIndex={-1} aria-label={`Questão ${idx + 1} de ${qs.length}`} className="rounded-[var(--radius-card)] outline-none focus-visible:ring-4 focus-visible:ring-brand-100">
          <Card className="p-5 sm:p-7">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone="brand">{backend.disciplineName(q)}</Badge>
              {q.topic && <Badge tone="neutral">{q.topic}</Badge>}
              {q.sourceLabel && <Badge tone="neutral">{q.sourceLabel}</Badge>}
              {q.items.length > 1 && <Badge tone="blue">{q.items.length} perguntas</Badge>}
            </div>
            <RichText text={q.stem} className="text-[15px] leading-relaxed" />
            {q.hasImage && q.imageDescription && (
              <div className="mt-4 flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                <ImageIcon size={18} className="mt-0.5 shrink-0" />
                <span>
                  <b>Imagem:</b> {q.imageDescription}
                </span>
              </div>
            )}
            <div className="mt-5 space-y-5">
              {q.items.map((it, i) => (
                <ItemView
                  key={it.id}
                  item={it}
                  index={i}
                  multi={q.items.length > 1}
                  topic={q.topic}
                  kind={backend.kindOf(it)}
                  ans={answers[it.id] ?? blank(it.id)}
                  update={(p) => update(it.id, p)}
                  onReveal={(checked) => reveal(it, checked)}
                  backend={backend}
                  onGraded={(patch) => update(it.id, patch, false)}
                  revealNow={revealNow}
                  aiHints={!isProva && cfg.aiHints}
                />
              ))}
            </div>
          </Card>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button variant="secondary" disabled={idx === 0} onClick={() => go(idx - 1)}>
              <ChevronLeft size={16} /> Anterior
            </Button>
            <button
              onClick={() => {
                backend.saveFlag(q.id, !isFlagged)
                setFlagged((f) => (f.includes(q.id) ? f.filter((x) => x !== q.id) : [...f, q.id]))
              }}
              className={clsx('inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold', isFlagged ? 'bg-gold-100 text-gold-600' : 'text-muted hover:bg-gold-50')}
            >
              <Flag size={15} /> {isFlagged ? 'Marcada' : 'Marcar p/ revisar'}
            </button>
            {idx < qs.length - 1 ? (
              <Button onClick={() => go(idx + 1)}>
                Próxima <ChevronRight size={16} />
              </Button>
            ) : (
              <Button variant="gold" onClick={() => setConfirmFinish(true)}>
                Finalizar <Check size={16} />
              </Button>
            )}
          </div>
          <p className="mt-3 hidden text-center text-xs text-muted sm:block">Atalhos: ← → navegar · A–E escolher alternativa</p>
        </main>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Questões</p>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {qs.map((x, i) => {
                const its = x.items.map((it) => answers[it.id])
                const done = its.filter(isAnswered).length
                const allDone = done === x.items.length
                const revealed = revealNow && its.every((a) => a?.score != null)
                const avg = revealed ? its.reduce((s, a) => s + (a?.score ?? 0), 0) / its.length : 0
                return (
                  <button
                    key={x.id}
                    onClick={() => go(i)}
                    className={clsx(
                      'relative aspect-square rounded-lg text-xs font-bold transition',
                      i === idx
                        ? 'bg-brand-600 text-white'
                        : revealed
                          ? avg >= 0.5
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                          : allDone
                            ? 'bg-brand-100 text-brand-700'
                            : done
                              ? 'bg-brand-50 text-brand-600 ring-1 ring-brand-200'
                              : 'bg-slate-100 text-muted hover:bg-brand-50',
                    )}
                    aria-label={`Ir para questão ${i + 1}`}
                  >
                    {i + 1}
                    {flagged.includes(x.id) && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-gold-400" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-4 space-y-1 text-[11px] text-muted">
              <p className="flex items-center gap-1.5">
                <i className="size-2.5 rounded bg-brand-100" /> todas as perguntas respondidas
              </p>
              <p className="flex items-center gap-1.5">
                <i className="size-2.5 rounded bg-brand-50 ring-1 ring-brand-200" /> parcialmente
              </p>
              <p className="flex items-center gap-1.5">
                <i className="size-2.5 rounded-full bg-gold-400" /> marcada p/ revisar
              </p>
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title="Finalizar simulado?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmFinish(false)}>
              Continuar respondendo
            </Button>
            <Button onClick={() => void finish()} disabled={finishing}>
              {finishing ? 'Finalizando…' : 'Finalizar e ver gabarito'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Você respondeu <b>{answeredItems}</b> de <b>{totalItems}</b> perguntas ({qs.length} questões) em <b>{formatDuration(elapsed)}</b>.
          {answeredItems < totalItems && ' Perguntas em branco contam como erro.'}
        </p>
        {finishError && (
          <p role="alert" className="mt-3 text-sm text-rose-600">
            {finishError}
          </p>
        )}
      </Modal>
      <Modal
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Sair do simulado?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmExit(false)}>
              Ficar
            </Button>
            <Button variant="danger" onClick={() => navigate('/simulados')}>
              Sair sem finalizar
            </Button>
          </>
        }
      >
        <p className="text-sm">O simulado fica salvo como não finalizado (dá para continuar pelo histórico) e só pontua depois de finalizado.</p>
      </Modal>
    </div>
  )
}

function ItemView({
  item,
  index,
  multi,
  topic,
  kind,
  ans,
  update,
  revealNow,
  aiHints,
  onReveal,
  backend,
  onGraded,
}: {
  item: QuestionItem
  index: number
  multi: boolean
  topic?: string
  kind: AnswerKind
  ans: ItemAnswer
  update: (p: Partial<ItemAnswer>) => void
  revealNow: boolean
  aiHints: boolean
  /** Revela o gabarito (treino) — devolve a pergunta com o gabarito. */
  onReveal: (checked?: boolean[]) => Promise<QuestionItem>
  backend: RunnerBackend
  /** Nota vinda da correção por IA (já gravada pelo backend). */
  onGraded: (patch: Partial<ItemAnswer>) => void
}) {
  const [eliminated, setEliminated] = useState<Set<string>>(new Set())
  const [ai, setAi] = useState<AiExplanation | null>(null)
  const [aiLoading, setAiLoading] = useState<'hint' | 'explain' | 'grade' | null>(null)
  const [showExpected, setShowExpected] = useState(false)
  const [checked, setChecked] = useState<boolean[]>([])
  const [busy, setBusy] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const confirmed = revealNow && ans.score != null
  async function doReveal(checkedNow?: boolean[]) {
    setBusy(true)
    setRevealError(null)
    try {
      return await onReveal(checkedNow)
    } catch (err) {
      setRevealError((err as Error).message || 'Não foi possível mostrar o gabarito.')
      return null
    } finally {
      setBusy(false)
    }
  }
  const alts = item.alternatives ?? []

  const [aiError, setAiError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const demo = backend.aiDemo ? <DemoTag /> : null

  async function askAi(mode: 'hint' | 'explain') {
    setAiLoading(mode)
    setAiError(null)
    try {
      if (mode === 'hint') {
        const hint = await backend.hint(item, topic)
        setAi({ hint, perAlternative: [], summary: '', model: '' })
        // O servidor já marcou `used_hint`; aqui só reflete na tela (persist = false).
        if (!confirmed) onGraded({ usedHint: true })
      } else {
        setAi(await backend.explain(item, topic))
      }
    } catch (err) {
      setAiError((err as Error).message || 'IA indisponível agora.')
    } finally {
      setAiLoading(null)
    }
  }

  async function gradeWithAi() {
    setAiLoading('grade')
    setAiError(null)
    try {
      const r = await backend.aiGrade(item, ans)
      setChecked(r.matched)
      setFeedback(r.feedback ?? null)
      onGraded(r.answer)
    } catch (err) {
      setAiError((err as Error).message || 'IA indisponível agora — use a autocorreção.')
    } finally {
      setAiLoading(null)
    }
  }

  return (
    <section className={clsx(multi && 'rounded-2xl border border-line p-4')}>
      {multi && (
        <div className="mb-3 flex items-start gap-1.5 font-display text-base font-semibold leading-snug">
          <span
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs text-white"
            title={item.label ?? undefined}
          >
            <span aria-hidden>{itemMarker(item.label, index)}</span>
            <span className="sr-only">{item.label ? `${item.label}:` : `Pergunta ${index + 1}:`}</span>
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <RichText text={item.prompt} />
            {item.type === 'discursiva' && kind === 'objetiva' && <Badge tone="gold" className="mt-1">alternativas geradas por IA</Badge>}
          </div>
        </div>
      )}
      {!multi && item.type === 'discursiva' && kind === 'objetiva' && <Badge tone="gold" className="mb-2">alternativas geradas por IA</Badge>}

      {kind === 'objetiva' ? (
        <ul className="space-y-2">
          {alts.map((a, i) => {
            const selected = ans.choiceId === a.id
            const out = eliminated.has(a.id)
            const verdict = confirmed ? (a.correct ? 'right' : selected ? 'wrong' : null) : null
            const aiWhy = ai && confirmed ? ai.perAlternative.find((p) => p.id === a.id)?.why : null
            return (
              <li key={a.id}>
                <div
                  className={clsx(
                    'group flex items-start gap-3 rounded-xl border-2 p-3 transition',
                    verdict === 'right' && 'border-emerald-400 bg-emerald-50',
                    verdict === 'wrong' && 'border-rose-400 bg-rose-50',
                    !verdict && selected && 'border-brand-500 bg-brand-50',
                    !verdict && !selected && 'border-line bg-white hover:border-brand-200',
                  )}
                >
                  <button disabled={confirmed} onClick={() => update({ choiceId: a.id })} className="flex flex-1 items-start gap-3 text-left disabled:cursor-default">
                    <span
                      className={clsx(
                        'flex size-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold',
                        verdict === 'right' ? 'bg-emerald-500 text-white' : verdict === 'wrong' ? 'bg-rose-500 text-white' : selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-muted',
                      )}
                    >
                      {verdict === 'right' ? <Check size={15} /> : verdict === 'wrong' ? <X size={15} /> : LETTERS[i]}
                    </span>
                    <span className={clsx('pt-0.5 text-[15px]', out && 'text-slate-400 line-through')}>
                      {a.text}
                      {confirmed && (aiWhy || a.explanation) && <span className="mt-1 block text-sm text-muted">{aiWhy ?? a.explanation}</span>}
                    </span>
                  </button>
                  {!confirmed && (
                    <button
                      onClick={() =>
                        setEliminated((s) => {
                          const n = new Set(s)
                          if (n.has(a.id)) n.delete(a.id)
                          else n.add(a.id)
                          return n
                        })
                      }
                      className="rounded-lg p-1 text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                      title="Riscar alternativa"
                      aria-label={`Riscar alternativa ${LETTERS[i]}`}
                    >
                      <Scissors size={15} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div>
          <textarea
            className={clsx(inputClass, 'min-h-32 text-[15px]')}
            placeholder="Escreva sua resposta completa, como na prova…"
            value={ans.text ?? ''}
            // Depois de ver a resposta esperada a resposta fica travada (também no servidor).
            disabled={confirmed || showExpected}
            onChange={(e) => update({ text: e.target.value })}
            aria-label={`Resposta ${itemLabel(item, index)}`}
          />
          {revealNow && !showExpected && (
            <Button
              variant="secondary"
              className="mt-3"
              disabled={busy}
              onClick={async () => {
                const keyed = await doReveal()
                if (!keyed) return
                setShowExpected(true)
                setChecked((keyed.keyPoints ?? []).map(() => false))
              }}
            >
              {busy ? 'Abrindo…' : 'Ver resposta esperada e corrigir'}
            </Button>
          )}
          {revealNow && showExpected && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Resposta esperada</p>
              <RichText text={item.expectedAnswer} className="mt-1 text-sm leading-relaxed" />
              {(item.keyPoints?.length ?? 0) > 0 && (
                <>
                  <p className="mt-4 text-xs font-bold uppercase tracking-wide text-emerald-700">Pontos de acerto — marque o que você citou</p>
                  <ul className="mt-2 space-y-1.5">
                    {item.keyPoints!.map((kp, i) => (
                      <li key={kp}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-emerald-600"
                            checked={checked[i] ?? false}
                            disabled={confirmed}
                            onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                          />
                          {kp}
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!confirmed ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void doReveal(checked)}>
                    {busy ? 'Salvando…' : 'Confirmar autocorreção'}
                  </Button>
                  {aiHints && (
                    <Button size="sm" variant="gold" disabled={!ans.text?.trim() || aiLoading === 'grade' || busy} onClick={() => void gradeWithAi()}>
                      <Sparkles size={14} /> {aiLoading === 'grade' ? 'Corrigindo…' : 'Corrigir com IA'} {demo}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <p className="mt-3 font-display text-sm font-bold text-emerald-700">
                    Nota nesta pergunta: {Math.round((ans.score ?? 0) * 100)}% {ans.gradedBy === 'ia' ? '(corrigida pela IA)' : '(autocorreção)'}
                  </p>
                  {feedback && <p className="mt-1 text-sm text-muted">{feedback}</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {kind === 'objetiva' && (revealNow || aiHints) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {revealNow && !confirmed && (
            <Button size="sm" disabled={!ans.choiceId || busy} onClick={() => void doReveal()}>
              {busy ? 'Conferindo…' : 'Confirmar resposta'}
            </Button>
          )}
          {aiHints && !confirmed && (
            <Button size="sm" variant="secondary" disabled={aiLoading === 'hint'} onClick={() => askAi('hint')}>
              <Lightbulb size={14} /> {aiLoading === 'hint' ? 'Pensando…' : 'Pedir dica'} {demo}
            </Button>
          )}
          {aiHints && confirmed && !ai?.perAlternative.length && (
            <Button size="sm" variant="gold" disabled={aiLoading === 'explain'} onClick={() => askAi('explain')}>
              <BrainCircuit size={14} /> {aiLoading === 'explain' ? 'Gerando explicação…' : 'Explicar com IA'} {demo}
            </Button>
          )}
          {ans.usedHint && !confirmed && <span className="text-xs text-gold-600">Dica usada: esta pergunta vale metade dos pontos.</span>}
          {aiError && (
            <span role="alert" className="text-xs text-rose-600">
              {aiError}
            </span>
          )}
        </div>
      )}
      {revealError && (
        <p role="alert" className="mt-2 text-sm text-rose-600">
          {revealError}
        </p>
      )}
      {ai && !confirmed && (
        <p className="mt-3 flex gap-2 rounded-xl bg-gold-50 p-3 text-sm text-gold-600">
          <Lightbulb size={16} className="mt-0.5 shrink-0" /> {ai.hint}
        </p>
      )}
      {kind === 'discursiva' && aiError && (
        <p role="alert" className="mt-2 text-xs text-rose-600">
          {aiError}
        </p>
      )}
      {ai && confirmed && ai.summary && (
        <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">
          <p className="font-bold text-brand-700">Resumo da IA</p>
          <p className="mt-1 whitespace-pre-line">{ai.summary}</p>
          <p className="mt-2 text-[11px] text-muted">{ai.model}</p>
        </div>
      )}
    </section>
  )
}
