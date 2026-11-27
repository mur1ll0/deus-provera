import type { AnswerKind, ItemAnswer, Question, QuestionItem, SimuladoAttempt, SimuladoConfig } from '@shared/domain'
import type { AnswerView, AttemptView, ItemKey, PublicQuestion, ResultView } from '@shared/schemas/simulado'
import { api, unwrap } from '@/lib/api'

/**
 * Simulados na API real (spec 003): chamadas + adaptadores das visões do servidor para os tipos de domínio
 * que as telas já usam (`Question`, `SimuladoAttempt`). O gabarito só existe no cliente depois de revelado
 * (treino) ou no resultado — antes disso as alternativas vêm com `correct: false` e sem explicação.
 */

export const OTHER_OWNER = 'outro-usuario'

/** Pergunta pública + (se houver) o gabarito revelado. */
export function mergeKey(it: PublicQuestion['items'][number], key?: ItemKey): QuestionItem {
  const byId = new Map(key?.alternatives.map((a) => [a.id, a]))
  return {
    id: it.id,
    label: it.label,
    prompt: it.prompt,
    type: it.type,
    expectedAnswer: key?.expectedAnswer,
    keyPoints: key?.keyPoints ?? [],
    alternatives: it.alternatives?.map((a) => ({ id: a.id, text: a.text, correct: byId.get(a.id)?.correct ?? false, explanation: byId.get(a.id)?.explanation, source: 'usuario' as const })),
  }
}

export function toQuestions(view: Pick<AttemptView, 'questions' | 'keys'>, meId: string): Question[] {
  return view.questions.map((q) => ({
    id: q.id,
    ownerId: q.own ? meId : OTHER_OWNER,
    groupId: '',
    areaId: q.area,
    // O nome vai no lugar do id: as telas exibem via `disciplineName(q)`.
    disciplineId: q.discipline,
    topic: q.topic,
    sourceLabel: q.sourceLabel,
    stem: q.stem,
    items: q.items.map((it) => mergeKey(it, view.keys[it.id])),
    difficulty: q.difficulty,
    visibility: 'privada',
    origin: 'manual',
    hasImage: q.hasImage,
    imageDescription: q.imageDescription,
    createdAt: '',
  }))
}

/** Como cada pergunta é respondida (vem do servidor: o cliente não tem o gabarito para calcular). */
export function kindsOf(view: Pick<AttemptView, 'questions'>): Map<string, AnswerKind> {
  return new Map(view.questions.flatMap((q) => q.items.map((it) => [it.id, it.presentAs] as const)))
}

export const toItemAnswer = (itemId: string, a: AnswerView): ItemAnswer => ({
  itemId,
  choiceId: a.choiceId,
  text: a.text,
  score: a.score,
  gradedBy: a.gradedBy,
  usedHint: a.usedHint || undefined,
  revealedBeforeAnswer: a.revealedBeforeAnswer || undefined,
})

export function toAttempt(view: AttemptView | ResultView, meId: string): SimuladoAttempt {
  return {
    id: view.id,
    userId: meId,
    config: view.config,
    questionIds: view.questions.map((q) => q.id),
    answers: Object.fromEntries(Object.entries(view.answers).map(([k, a]) => [k, toItemAnswer(k, a)])),
    timeMs: view.timeMs,
    flagged: view.flagged,
    startedAt: view.startedAt,
    finishedAt: 'finishedAt' in view ? view.finishedAt : undefined,
    totalTimeMs: 'totalTimeMs' in view ? view.totalTimeMs : 0,
    points: 'score' in view ? view.score.total : undefined,
  }
}

/* --------------------------------- chamadas --------------------------------- */

const sim = api.simulados

export const fetchAttempt = (id: string) => unwrap(sim[':id'].$get({ param: { id } })) as Promise<AttemptView>
export const fetchResult = (id: string) => unwrap(sim[':id'].result.$get({ param: { id } })) as Promise<ResultView>
export const createRemote = (cfg: SimuladoConfig) => unwrap(sim.index.$post({ json: cfg }))
export const previewRemote = (cfg: SimuladoConfig) => unwrap(sim.preview.$post({ json: cfg }))
export const listRemote = () => unwrap(sim.index.$get())

export const putAnswer = (id: string, itemId: string, body: { choiceId?: string | null; text?: string | null; usedHint?: true }) =>
  unwrap(sim[':id'].answers[':itemId'].$put({ param: { id, itemId }, json: body }))
/** `keepalive`: o tempo da questão aberta ainda chega ao servidor quando a aba fecha ou o usuário sai. */
export const putProgress = (id: string, questionId: string, body: { timeMsDelta?: number; flagged?: boolean }) =>
  unwrap(sim[':id'].questions[':questionId'].$put({ param: { id, questionId }, json: body }, { init: { keepalive: true } }))
export const postReveal = (id: string, itemId: string, checked?: boolean[]) => unwrap(sim[':id'].reveal[':itemId'].$post({ param: { id, itemId }, json: { checked } }))
export const postFinish = (id: string) => unwrap(sim[':id'].finish.$post({ param: { id } }))
export const postGrade = (id: string, itemId: string, checked: boolean[]) => unwrap(sim[':id'].grade[':itemId'].$post({ param: { id, itemId }, json: { checked } }))

/** Item já carregado (sem gabarito) + gabarito devolvido por /reveal. */
export function withKey(item: QuestionItem, key: ItemKey): QuestionItem {
  return mergeKey({ id: item.id, label: item.label, prompt: item.prompt, type: item.type, presentAs: 'objetiva', keyPointCount: 0, alternatives: item.alternatives?.map((a) => ({ id: a.id, text: a.text })) }, key)
}

/* --------------------------------- IA (spec 005) --------------------------------- */

export const postHint = (id: string, itemId: string) => unwrap(sim[':id'].hint[':itemId'].$post({ param: { id, itemId } }))
export const postExplain = (id: string, itemId: string) => unwrap(sim[':id'].explain[':itemId'].$post({ param: { id, itemId } }))
export const postAiGrade = (id: string, itemId: string) => unwrap(sim[':id']['ai-grade'][':itemId'].$post({ param: { id, itemId } }))
