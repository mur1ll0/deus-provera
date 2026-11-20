import type { AnswerKind, ItemAnswer, Question, QuestionItem, SimuladoAttempt } from '@shared/domain'
import { presentAs } from '@shared/simulado'
import type { StoreApi } from '@/mocks/store'
import { postFinish, postReveal, putAnswer, putProgress, withKey } from './remote'
import { autoGrade, computeAttemptScore } from './scoringAdapter'

/**
 * O executor do simulado (SimuladoRunnerPage) fala com um "backend":
 *  - remoto (API real — spec 003): salva respostas/tempo no servidor e recebe o gabarito só ao revelar;
 *  - local (protótipo sem API): store em memória, como antes.
 */

export type SaveStatus = 'ok' | 'saving' | 'error'

export interface RunnerState {
  answers: Record<string, ItemAnswer>
  timeMs: Record<string, number>
  flagged: string[]
  totalTimeMs: number
}

export interface RunnerBackend {
  disciplineName: (q: Question) => string
  kindOf: (it: QuestionItem) => AnswerKind
  /** Limite de tempo exibido (null = sem limite). */
  limitMs: number | null
  /** relógio do servidor − relógio local. */
  clockOffsetMs: number
  /** Correção da discursiva por IA no ato: só a simulada do protótipo (a real chega com a spec 005). */
  aiGradeDemo: boolean
  saveAnswer: (itemId: string, patch: Partial<ItemAnswer>) => void
  saveTime: (questionId: string, deltaMs: number) => void
  saveFlag: (questionId: string, flagged: boolean) => void
  /** Revela o gabarito da pergunta (treino com correção imediata); `checked` = autocorreção da discursiva. */
  reveal: (item: QuestionItem, current: ItemAnswer, checked?: boolean[]) => Promise<{ item: QuestionItem; answer: Partial<ItemAnswer> }>
  finish: (state: RunnerState) => Promise<void>
  /** Estado do salvamento (indicador no topo). */
  subscribe: (fn: (s: SaveStatus) => void) => () => void
}

/* --------------------------------- local --------------------------------- */

export function localBackend(attempt: SimuladoAttempt, store: StoreApi, byId: Map<string, Question>): RunnerBackend {
  return {
    disciplineName: (q) => store.disciplineName(q.disciplineId),
    kindOf: (it) => presentAs(it, attempt.config.answerFormat),
    limitMs: attempt.config.timeLimitMin ? attempt.config.timeLimitMin * 60_000 : null,
    clockOffsetMs: 0,
    aiGradeDemo: true,
    saveAnswer: () => {},
    saveTime: () => {},
    saveFlag: () => {},
    reveal: async (item, current, checked) => {
      if (presentAs(item, attempt.config.answerFormat) === 'objetiva') {
        const correct = item.alternatives?.find((a) => a.correct)?.id
        return { item, answer: { score: current.choiceId === correct ? 1 : 0, gradedBy: 'auto' } }
      }
      if (checked) return { item, answer: { score: checked.filter(Boolean).length / Math.max(1, checked.length), gradedBy: 'checklist' } }
      return { item, answer: current.text?.trim() ? {} : { revealedBeforeAnswer: true } }
    },
    finish: async (s) => {
      const at = Date.now()
      const graded = autoGrade({ ...attempt, ...s, finishedAt: new Date(at).toISOString() }, byId)
      store.saveAttempt({ ...graded, points: computeAttemptScore(graded, byId, store.me.id).total })
    },
    subscribe: () => () => {},
  }
}

/* --------------------------------- remoto --------------------------------- */

const TEXT_DEBOUNCE_MS = 800

export function remoteBackend(opts: { attemptId: string; limitMs: number | null; clockOffsetMs: number; kinds: Map<string, AnswerKind> }): RunnerBackend {
  const { attemptId } = opts
  const listeners = new Set<(s: SaveStatus) => void>()
  let inFlight = 0
  let failed = false
  const emit = () => listeners.forEach((fn) => fn(failed ? 'error' : inFlight ? 'saving' : 'ok'))

  /** Pendências por chave (a última vence) — reenviadas ao salvar de novo ou ao finalizar. */
  const pending = new Map<string, () => Promise<unknown>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const timeAcc = new Map<string, number>()

  async function run(key: string) {
    const job = pending.get(key)
    if (!job) return
    pending.delete(key)
    inFlight++
    emit()
    try {
      await job()
      failed = false
    } catch (err) {
      // 409 (prazo/travada/finalizado) não adianta reenviar; o resto volta para a fila.
      if ((err as { status?: number }).status !== 409 && !pending.has(key)) pending.set(key, job)
      failed = (err as { status?: number }).status !== 409
    } finally {
      inFlight--
      emit()
    }
  }

  function schedule(key: string, job: () => Promise<unknown>, delay = 0) {
    pending.set(key, job)
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(() => void run(key), delay))
  }

  async function flush() {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    await Promise.all([...pending.keys()].map((k) => run(k)))
  }

  return {
    disciplineName: (q) => q.disciplineId, // o adaptador põe o nome no lugar do id
    kindOf: (it) => opts.kinds.get(it.id) ?? 'discursiva',
    limitMs: opts.limitMs,
    clockOffsetMs: opts.clockOffsetMs,
    aiGradeDemo: false,
    saveAnswer: (itemId, patch) => {
      if (patch.choiceId !== undefined) schedule(`choice:${itemId}`, () => putAnswer(attemptId, itemId, { choiceId: patch.choiceId ?? null }))
      if (patch.text !== undefined) schedule(`text:${itemId}`, () => putAnswer(attemptId, itemId, { text: patch.text ?? null }), TEXT_DEBOUNCE_MS)
      if (patch.usedHint) schedule(`hint:${itemId}`, () => putAnswer(attemptId, itemId, { usedHint: true }))
    },
    saveTime: (qid, deltaMs) => {
      // Acumula: o envio leva tudo o que juntou até rodar; se falhar, devolve ao acumulador.
      timeAcc.set(qid, (timeAcc.get(qid) ?? 0) + Math.max(0, Math.round(deltaMs)))
      schedule(`time:${qid}`, async () => {
        const ms = Math.min(timeAcc.get(qid) ?? 0, 600_000)
        timeAcc.set(qid, (timeAcc.get(qid) ?? 0) - ms)
        if (!ms) return
        try {
          await putProgress(attemptId, qid, { timeMsDelta: ms })
        } catch (err) {
          timeAcc.set(qid, (timeAcc.get(qid) ?? 0) + ms)
          throw err
        }
      })
    },
    saveFlag: (qid, flagged) => schedule(`flag:${qid}`, () => putProgress(attemptId, qid, { flagged })),
    reveal: async (item, _current, checked) => {
      await run(`text:${item.id}`) // o texto digitado entra antes de travar
      await run(`choice:${item.id}`)
      const r = await postReveal(attemptId, item.id, checked)
      return { item: withKey(item, r.key), answer: { score: r.answer.score, gradedBy: r.answer.gradedBy, revealedBeforeAnswer: r.answer.revealedBeforeAnswer || undefined } }
    },
    finish: async () => {
      await flush()
      await postFinish(attemptId)
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
