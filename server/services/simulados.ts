import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { QuestionItem, SimuladoConfig } from '../../shared/domain'
import { inspectText } from '../../shared/guardrails'
import type { z } from 'zod'
import type { answerInput, AnswerView, AttemptView, GradeResult, HistoryItem, ItemKey, PreviewView, progressInput, PublicQuestion, ResultView, RevealResult, ScoreDetail } from '../../shared/schemas/simulado'
import { scoreSimulado } from '../../shared/scoring'
import { autoTimeLimitMin, isEligible, presentAs } from '../../shared/simulado'
import { db, schema } from '../db/client'
import { loadItems } from './questions'

/**
 * Simulados (spec 003). Regras críticas ficam no SERVIDOR (o cliente só exibe):
 *  - sorteio (enunciado + todas as suas perguntas), prazo e tempo automático;
 *  - gabarito nunca sai antes da hora (prova: só no resultado; treino: por pergunta, ao revelar);
 *  - pontuação por PERGUNTA com shared/scoring.ts, gravada no points_ledger (idempotente).
 */

const { attempt, attemptQuestion, attemptAnswer, question, area, discipline, pointsLedger } = schema
type AttemptRow = typeof attempt.$inferSelect
type AnswerRow = typeof attemptAnswer.$inferSelect
type Config = SimuladoConfig

const NETWORK_GRACE_MS = 15_000
const DAY = 86_400_000

/* --------------------------------- sorteio --------------------------------- */

function poolFilters(userId: string, cfg: Config, withTopics = true) {
  const q = question
  return and(
    isNull(q.deletedAt),
    cfg.scope === 'minhas' ? eq(q.ownerId, userId) : or(eq(q.ownerId, userId), eq(q.visibility, 'publica')),
    cfg.areaId ? eq(q.areaId, cfg.areaId) : undefined,
    cfg.disciplineIds.length ? inArray(q.disciplineId, cfg.disciplineIds) : undefined,
    withTopics && cfg.topics.length ? inArray(q.topic, cfg.topics) : undefined,
  )
}

/** Questões com alguma pergunta errada (< 0,5) pelo usuário — base de "priorizar o que errei". */
const missedQuestionIds = (userId: string) =>
  db()
    .selectDistinct({ id: attemptAnswer.questionId })
    .from(attemptAnswer)
    .innerJoin(attempt, eq(attempt.id, attemptAnswer.attemptId))
    .where(and(eq(attempt.userId, userId), isNotNull(attempt.finishedAt), lt(attemptAnswer.score, 0.5)))

/** Candidatos elegíveis em ordem de sorteio (os errados primeiro, se pedido). */
async function drawPool(userId: string, cfg: Config, limit: number) {
  const order = cfg.prioritizeMistakes ? [sql`case when ${question.id} in (${missedQuestionIds(userId)}) then 0 else 1 end`, sql`random()`] : [sql`random()`]
  const rows = await db()
    .select({ id: question.id, topic: question.topic })
    .from(question)
    .where(poolFilters(userId, cfg))
    .orderBy(...order)
    .limit(limit)
  const items = await loadItems(rows.map((r) => r.id))
  return rows.filter((r) => isEligible({ items: items.get(r.id) ?? [] }, cfg.answerFormat)).map((r) => ({ ...r, items: items.get(r.id) ?? [] }))
}

export async function previewSimulado(userId: string, cfg: Config): Promise<PreviewView> {
  const [pool, topicRows] = await Promise.all([
    drawPool(userId, cfg, 500),
    db().selectDistinct({ topic: question.topic }).from(question).where(and(poolFilters(userId, cfg, false), isNotNull(question.topic))),
  ])
  return {
    available: pool.length,
    topics: topicRows.map((t) => t.topic!).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    kinds: pool.slice(0, 100).map((q) => q.items.map((it) => presentAs(it, cfg.answerFormat))),
    answerFormat: cfg.answerFormat,
  }
}

export async function createSimulado(userId: string, input: Config): Promise<{ id: string; config: Config; deadlineAt: string | null }> {
  // Prova: regras fixas, independentemente do que o cliente mandou (assuntos ignorados — spec 003).
  const cfg: Config = input.mode === 'prova' ? { ...input, reveal: 'final', aiHints: false, topics: [] } : { ...input }
  const picked = (await drawPool(userId, cfg, cfg.count * 4 + 20)).slice(0, cfg.count)
  if (!picked.length) throw new HTTPException(422, { message: 'Nenhuma questão com esses filtros e formato de resposta.' })
  if (cfg.mode === 'prova' && !cfg.timeLimitMin) {
    cfg.timeLimitMin = autoTimeLimitMin(picked.flatMap((p) => p.items.map((it) => presentAs(it, cfg.answerFormat))))
  }
  cfg.count = picked.length
  const timeLimitMs = cfg.timeLimitMin ? cfg.timeLimitMin * 60_000 : null
  const id = crypto.randomUUID()
  const startedAt = new Date()
  const deadlineAt = timeLimitMs ? new Date(startedAt.getTime() + timeLimitMs + NETWORK_GRACE_MS) : null
  const d = db()
  await d.batch([
    d.insert(attempt).values({ id, userId, mode: cfg.mode, config: cfg as unknown as Record<string, unknown>, questionIds: picked.map((p) => p.id), timeLimitMs, startedAt, deadlineAt }),
    d.insert(attemptQuestion).values(picked.map((p, position) => ({ attemptId: id, questionId: p.id, position }))),
  ])
  return { id, config: cfg, deadlineAt: deadlineAt?.toISOString() ?? null }
}

/* --------------------------------- leitura --------------------------------- */

async function ownedAttempt(userId: string, id: string): Promise<AttemptRow> {
  const [a] = await db()
    .select()
    .from(attempt)
    .where(and(eq(attempt.id, id), eq(attempt.userId, userId)))
  if (!a) throw new HTTPException(404, { message: 'Simulado não encontrado.' })
  return a
}

const configOf = (a: AttemptRow) => a.config as unknown as Config

interface Loaded {
  rows: Map<string, typeof question.$inferSelect & { areaName: string; disciplineName: string }>
  items: Map<string, QuestionItem[]>
  itemOwner: Map<string, string>
}

async function loadQuestions(ids: string[]): Promise<Loaded> {
  const rows = ids.length
    ? await db()
        .select({ q: question, areaName: area.name, disciplineName: discipline.name })
        .from(question)
        .innerJoin(area, eq(area.id, question.areaId))
        .innerJoin(discipline, eq(discipline.id, question.disciplineId))
        .where(inArray(question.id, ids))
    : []
  const items = await loadItems(ids)
  const itemOwner = new Map<string, string>()
  for (const [qid, its] of items) for (const it of its) itemOwner.set(it.id, qid)
  return { rows: new Map(rows.map((r) => [r.q.id, { ...r.q, areaName: r.areaName, disciplineName: r.disciplineName }])), items, itemOwner }
}

function publicQuestion(userId: string, cfg: Config, loaded: Loaded, qid: string): PublicQuestion | null {
  const r = loaded.rows.get(qid)
  if (!r) return null
  return {
    id: r.id,
    area: r.areaName,
    discipline: r.disciplineName,
    topic: r.topic ?? undefined,
    sourceLabel: r.sourceLabel ?? undefined,
    stem: r.stem,
    hasImage: r.hasImage,
    imageDescription: r.imageDescription ?? undefined,
    difficulty: r.difficulty,
    own: r.ownerId === userId,
    items: (loaded.items.get(qid) ?? []).map((it) => {
      const kind = presentAs(it, cfg.answerFormat)
      return {
        id: it.id,
        label: it.label,
        prompt: it.prompt,
        type: it.type,
        presentAs: kind,
        // NUNCA `correct`/`explanation` aqui (T008).
        alternatives: kind === 'objetiva' ? (it.alternatives ?? []).map((a) => ({ id: a.id, text: a.text })) : undefined,
        keyPointCount: it.keyPoints?.length ?? 0,
      }
    }),
  }
}

const keyOf = (it: QuestionItem): ItemKey => ({
  itemId: it.id,
  alternatives: (it.alternatives ?? []).map((a) => ({ id: a.id, correct: a.correct, explanation: a.explanation })),
  expectedAnswer: it.expectedAnswer,
  keyPoints: it.keyPoints ?? [],
})

function answerView(row: AnswerRow | undefined, showScore: boolean): AnswerView {
  return {
    choiceId: row?.choiceId ?? undefined,
    text: row?.text ?? undefined,
    score: showScore ? (row?.score ?? null) : null,
    gradedBy: showScore ? (row?.gradedBy ?? undefined) : undefined,
    usedHint: row?.usedHint ?? false,
    revealedBeforeAnswer: row?.revealedBeforeAnswer ?? false,
    revealed: !!row?.revealedAt,
  }
}

async function progressOf(attemptId: string) {
  const [answers, perQuestion] = await Promise.all([
    db().select().from(attemptAnswer).where(eq(attemptAnswer.attemptId, attemptId)),
    db().select().from(attemptQuestion).where(eq(attemptQuestion.attemptId, attemptId)),
  ])
  return { answers: new Map(answers.map((x) => [x.itemId, x])), perQuestion }
}

export async function getSimulado(userId: string, id: string): Promise<AttemptView> {
  const a = await ownedAttempt(userId, id)
  if (a.finishedAt) throw new HTTPException(409, { message: 'finalizado' })
  const cfg = configOf(a)
  const [loaded, prog] = await Promise.all([loadQuestions(a.questionIds), progressOf(a.id)])
  const answers: Record<string, AnswerView> = {}
  const keys: Record<string, ItemKey> = {}
  for (const [itemId, row] of prog.answers) {
    // Prova: nada de nota/gabarito até o resultado. Treino: só o que já foi revelado.
    const revealed = cfg.mode === 'treino' && !!row.revealedAt
    answers[itemId] = answerView(row, revealed)
    const qid = loaded.itemOwner.get(itemId)
    const item = qid ? loaded.items.get(qid)?.find((i) => i.id === itemId) : undefined
    if (revealed && item) keys[itemId] = keyOf(item)
  }
  return {
    id: a.id,
    config: cfg,
    status: 'em_andamento',
    startedAt: a.startedAt.toISOString(),
    deadlineAt: a.deadlineAt?.toISOString() ?? null,
    timeLimitMs: a.timeLimitMs,
    serverNow: new Date().toISOString(),
    questions: a.questionIds.map((qid) => publicQuestion(userId, cfg, loaded, qid)).filter((q): q is PublicQuestion => !!q),
    answers,
    keys,
    timeMs: Object.fromEntries(prog.perQuestion.map((p) => [p.questionId, p.timeMs])),
    flagged: prog.perQuestion.filter((p) => p.flagged).map((p) => p.questionId),
  }
}

/* --------------------------------- escrita --------------------------------- */

function assertOpen(a: AttemptRow) {
  if (a.finishedAt) throw new HTTPException(409, { message: 'Este simulado já foi finalizado.' })
  if (a.deadlineAt && Date.now() > a.deadlineAt.getTime()) throw new HTTPException(409, { message: 'O tempo do simulado acabou.' })
}

/** Pergunta da tentativa + como é apresentada; 404 se não pertence ao simulado. */
async function itemOf(a: AttemptRow, itemId: string) {
  const [it] = await db().select({ questionId: schema.questionItem.questionId }).from(schema.questionItem).where(eq(schema.questionItem.id, itemId))
  if (!it || !a.questionIds.includes(it.questionId)) throw new HTTPException(404, { message: 'Pergunta não encontrada neste simulado.' })
  const items = await loadItems([it.questionId])
  const item = items.get(it.questionId)!.find((i) => i.id === itemId)!
  return { questionId: it.questionId, item, kind: presentAs(item, configOf(a).answerFormat) }
}

export async function saveAnswer(userId: string, id: string, itemId: string, body: z.output<typeof answerInput>): Promise<AnswerView> {
  const a = await ownedAttempt(userId, id)
  assertOpen(a)
  const { questionId, item, kind } = await itemOf(a, itemId)
  const [current] = await db()
    .select()
    .from(attemptAnswer)
    .where(and(eq(attemptAnswer.attemptId, a.id), eq(attemptAnswer.itemId, itemId)))
  if (current?.revealedAt && (body.choiceId !== undefined || body.text !== undefined)) throw new HTTPException(409, { message: 'Resposta travada: o gabarito já foi mostrado.' })
  if (body.usedHint && configOf(a).mode === 'prova') throw new HTTPException(403, { message: 'Dicas não são permitidas na prova.' })

  const patch: Partial<typeof attemptAnswer.$inferInsert> = { answeredAt: new Date() }
  if (body.choiceId !== undefined) {
    if (body.choiceId && (kind !== 'objetiva' || !item.alternatives?.some((x) => x.id === body.choiceId))) throw new HTTPException(400, { message: 'Alternativa inválida para esta pergunta.' })
    patch.choiceId = body.choiceId
  }
  if (body.text !== undefined) {
    if (body.text && kind !== 'discursiva') throw new HTTPException(400, { message: 'Esta pergunta é de múltipla escolha.' })
    // Texto do aluno: guardrail antes de gravar (pode ir para a correção por IA depois — spec 005).
    patch.text = body.text ? inspectText(body.text).clean : null
  }
  if (body.usedHint) patch.usedHint = true

  const [row] = await db()
    .insert(attemptAnswer)
    .values({ attemptId: a.id, itemId, questionId, presentedAs: kind, ...patch })
    .onConflictDoUpdate({ target: [attemptAnswer.attemptId, attemptAnswer.itemId], set: patch })
    .returning()
  return answerView(row, false)
}

export async function saveProgress(userId: string, id: string, questionId: string, body: z.output<typeof progressInput>): Promise<{ timeMs: number; flagged: boolean }> {
  const a = await ownedAttempt(userId, id)
  if (a.finishedAt) throw new HTTPException(409, { message: 'Este simulado já foi finalizado.' })
  if (!a.questionIds.includes(questionId)) throw new HTTPException(404, { message: 'Questão não encontrada neste simulado.' })
  // O total por questão nunca passa da duração real da tentativa no servidor.
  const cap = Math.min(Date.now(), a.deadlineAt?.getTime() ?? Infinity) - a.startedAt.getTime()
  const [row] = await db()
    .update(attemptQuestion)
    .set({
      ...(body.timeMsDelta ? { timeMs: sql`least(${attemptQuestion.timeMs} + ${body.timeMsDelta}, ${Math.max(0, Math.round(cap))})` } : {}),
      ...(body.flagged !== undefined ? { flagged: body.flagged } : {}),
    })
    .where(and(eq(attemptQuestion.attemptId, a.id), eq(attemptQuestion.questionId, questionId)))
    .returning()
  return { timeMs: row?.timeMs ?? 0, flagged: row?.flagged ?? false }
}

/** Treino com correção imediata: revela o gabarito da pergunta e trava a resposta (T022). */
export async function revealItem(userId: string, id: string, itemId: string, checked?: boolean[]): Promise<RevealResult> {
  const a = await ownedAttempt(userId, id)
  const cfg = configOf(a)
  if (cfg.mode !== 'treino' || cfg.reveal !== 'imediato') throw new HTTPException(403, { message: 'O gabarito só aparece no final deste simulado.' })
  assertOpen(a)
  const { questionId, item, kind } = await itemOf(a, itemId)
  const [cur] = await db()
    .select()
    .from(attemptAnswer)
    .where(and(eq(attemptAnswer.attemptId, a.id), eq(attemptAnswer.itemId, itemId)))
  const answered = !!(cur?.choiceId || cur?.text?.trim())
  const patch: Partial<typeof attemptAnswer.$inferInsert> = { revealedAt: cur?.revealedAt ?? new Date() }
  if (!cur?.revealedAt) patch.revealedBeforeAnswer = !answered
  if (cur?.score == null) {
    if (kind === 'objetiva') {
      patch.score = cur?.choiceId && item.alternatives?.find((x) => x.correct)?.id === cur.choiceId ? 1 : 0
      patch.gradedBy = 'auto'
    } else if (!answered) {
      patch.score = 0
      patch.gradedBy = 'auto'
    } else if (checked) {
      // Autocorreção pelos pontos de acerto (vale metade no ranking — GRADER_WEIGHT.checklist).
      const total = item.keyPoints?.length ?? 0
      patch.score = total ? checked.slice(0, total).filter(Boolean).length / total : 0
      patch.gradedBy = 'checklist'
    }
  }
  const [row] = await db()
    .insert(attemptAnswer)
    .values({ attemptId: a.id, itemId, questionId, presentedAs: kind, ...patch })
    .onConflictDoUpdate({ target: [attemptAnswer.attemptId, attemptAnswer.itemId], set: patch })
    .returning()
  return { key: keyOf(item), answer: answerView(row, true) }
}

/* ------------------------------ pontuação ------------------------------ */

/**
 * Perguntas respondidas em OUTRAS tentativas finalizadas nos 7 dias antes do início desta (anti-farm).
 * Janela fixa no tempo: o resultado e as correções posteriores recalculam o mesmo valor.
 */
async function repeatedItems(a: AttemptRow, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set()
  const rows = await db()
    .selectDistinct({ itemId: attemptAnswer.itemId })
    .from(attemptAnswer)
    .innerJoin(attempt, eq(attempt.id, attemptAnswer.attemptId))
    .where(
      and(
        eq(attempt.userId, a.userId),
        ne(attempt.id, a.id),
        isNotNull(attempt.finishedAt),
        gte(attempt.finishedAt, new Date(a.startedAt.getTime() - 7 * DAY)),
        lt(attempt.finishedAt, a.startedAt),
        inArray(attemptAnswer.itemId, itemIds),
      ),
    )
  return new Set(rows.map((r) => r.itemId))
}

type FinalAnswer = { score: number | null; gradedBy?: 'auto' | 'checklist' | 'ia' | null; revealedBeforeAnswer?: boolean; usedHint?: boolean }

async function computeScore(a: AttemptRow, loaded: Loaded, finals: Map<string, FinalAnswer>, totalTimeMs: number): Promise<ScoreDetail> {
  const cfg = configOf(a)
  const allItems = a.questionIds.flatMap((qid) => (loaded.items.get(qid) ?? []).map((it) => ({ qid, it })))
  const repeated = await repeatedItems(a, allItems.map((x) => x.it.id))
  const s = scoreSimulado({
    mode: cfg.mode,
    timeLimitMs: a.timeLimitMs,
    totalTimeMs,
    questionCount: a.questionIds.length,
    questions: allItems.map(({ qid, it }) => {
      const f = finals.get(it.id)
      const q = loaded.rows.get(qid)
      return {
        answer: { score: f?.score ?? null, gradedBy: f?.gradedBy ?? undefined, revealedBeforeAnswer: f?.revealedBeforeAnswer, usedHint: f?.usedHint },
        difficulty: q?.difficulty ?? 'media',
        mode: cfg.mode,
        isOwnQuestion: q?.ownerId === a.userId,
        repeatedRecently: repeated.has(it.id),
      }
    }),
  })
  return { ...s, pending: allItems.filter(({ it }) => finals.get(it.id)?.score == null).length }
}

/** Finaliza: corrige objetivas, zera em branco, deixa discursivas com texto pendentes e lança no ledger (idempotente — T014/T015). */
export async function finishSimulado(userId: string, id: string): Promise<ScoreDetail & { id: string }> {
  const a = await ownedAttempt(userId, id)
  if (a.finishedAt && a.scoreDetail) return { id: a.id, ...a.scoreDetail }
  const cfg = configOf(a)
  const [loaded, prog] = await Promise.all([loadQuestions(a.questionIds), progressOf(a.id)])
  const finishedAt = new Date()
  const totalTimeMs = Math.max(0, Math.min(finishedAt.getTime() - a.startedAt.getTime(), a.timeLimitMs ?? Number.MAX_SAFE_INTEGER))

  const finals = new Map<string, FinalAnswer>()
  const upserts: (typeof attemptAnswer.$inferInsert)[] = []
  for (const qid of a.questionIds) {
    for (const it of loaded.items.get(qid) ?? []) {
      const row = prog.answers.get(it.id)
      const kind = presentAs(it, cfg.answerFormat)
      let score = row?.score ?? null
      let gradedBy = row?.gradedBy ?? null
      if (score == null) {
        if (kind === 'objetiva') {
          score = row?.choiceId && it.alternatives?.find((x) => x.correct)?.id === row.choiceId ? 1 : 0
          gradedBy = 'auto'
        } else if (!row?.text?.trim()) {
          score = 0 // em branco
          gradedBy = 'auto'
        } // discursiva com texto: pendente (correção posterior)
      }
      finals.set(it.id, { score, gradedBy, revealedBeforeAnswer: row?.revealedBeforeAnswer, usedHint: row?.usedHint })
      if (!row || row.score !== score) upserts.push({ attemptId: a.id, itemId: it.id, questionId: qid, presentedAs: kind, score, gradedBy })
    }
  }
  const detail = await computeScore(a, loaded, finals, totalTimeMs)

  const d = db()
  await d.batch([
    // Só a primeira finalização vale (WHERE finished_at IS NULL); o ledger tem índice único (tentativa, motivo).
    d
      .update(attempt)
      .set({ finishedAt, totalTimeMs, accuracy: detail.accuracy, points: detail.total, countsForRanking: detail.countsForRanking, scoreDetail: detail })
      .where(and(eq(attempt.id, a.id), isNull(attempt.finishedAt))),
    ...(upserts.length
      ? [
          d
            .insert(attemptAnswer)
            .values(upserts)
            .onConflictDoUpdate({ target: [attemptAnswer.attemptId, attemptAnswer.itemId], set: { score: sql`excluded.score`, gradedBy: sql`excluded.graded_by` }, where: isNull(attemptAnswer.score) }),
        ]
      : []),
    d
      .insert(pointsLedger)
      .values({ userId, attemptId: a.id, points: detail.countsForRanking ? detail.total : 0, reason: `simulado:${cfg.mode}` })
      .onConflictDoNothing(),
  ])
  const [fresh] = await db().select().from(attempt).where(eq(attempt.id, a.id))
  return { id: a.id, ...(fresh.scoreDetail ?? detail) }
}

/* --------------------------------- resultado --------------------------------- */

export async function getResult(userId: string, id: string): Promise<ResultView> {
  const a = await ownedAttempt(userId, id)
  if (!a.finishedAt || !a.scoreDetail) throw new HTTPException(409, { message: 'O simulado ainda não foi finalizado.' })
  const cfg = configOf(a)
  const [loaded, prog] = await Promise.all([loadQuestions(a.questionIds), progressOf(a.id)])
  const questions = a.questionIds.map((qid) => publicQuestion(userId, cfg, loaded, qid)).filter((q): q is PublicQuestion => !!q)
  const answers: Record<string, AnswerView> = {}
  const keys: Record<string, ItemKey> = {}
  const topics = new Map<string, { discipline: string; topic: string | null; items: number; sum: number }>()
  for (const q of questions) {
    const k = `${q.discipline}|${q.topic ?? ''}`
    const t = topics.get(k) ?? { discipline: q.discipline, topic: q.topic ?? null, items: 0, sum: 0 }
    for (const it of loaded.items.get(q.id) ?? []) {
      const row = prog.answers.get(it.id)
      answers[it.id] = answerView(row, true)
      keys[it.id] = keyOf(it)
      t.items++
      t.sum += row?.score ?? 0
    }
    topics.set(k, t)
  }
  return {
    id: a.id,
    config: cfg,
    status: 'finalizado',
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt.toISOString(),
    deadlineAt: a.deadlineAt?.toISOString() ?? null,
    timeLimitMs: a.timeLimitMs,
    totalTimeMs: a.totalTimeMs ?? 0,
    score: a.scoreDetail,
    questions,
    answers,
    keys,
    timeMs: Object.fromEntries(prog.perQuestion.map((p) => [p.questionId, p.timeMs])),
    flagged: prog.perQuestion.filter((p) => p.flagged).map((p) => p.questionId),
    byTopic: [...topics.values()].map((t) => ({ discipline: t.discipline, topic: t.topic, items: t.items, accuracy: t.items ? t.sum / t.items : 0 })),
  }
}

/** Correção posterior de uma discursiva pendente pelo checklist (T027): recalcula e lança a diferença no ranking. */
export async function gradeItem(userId: string, id: string, itemId: string, checked: boolean[]): Promise<GradeResult> {
  const a = await ownedAttempt(userId, id)
  if (!a.finishedAt || !a.scoreDetail) throw new HTTPException(409, { message: 'Finalize o simulado antes de corrigir.' })
  const { item } = await itemOf(a, itemId)
  const [row] = await db()
    .select()
    .from(attemptAnswer)
    .where(and(eq(attemptAnswer.attemptId, a.id), eq(attemptAnswer.itemId, itemId)))
  if (!row || row.score != null) throw new HTTPException(409, { message: 'Esta pergunta já foi corrigida.' })
  const total = item.keyPoints?.length ?? 0
  const score = total ? checked.slice(0, total).filter(Boolean).length / total : 0

  const [loaded, prog] = await Promise.all([loadQuestions(a.questionIds), progressOf(a.id)])
  const finals = new Map<string, FinalAnswer>([...prog.answers].map(([k, r]) => [k, { score: r.score, gradedBy: r.gradedBy, revealedBeforeAnswer: r.revealedBeforeAnswer, usedHint: r.usedHint }]))
  finals.set(itemId, { ...finals.get(itemId), score, gradedBy: 'checklist' })
  const detail = await computeScore(a, loaded, finals, a.totalTimeMs ?? 0)
  const delta = detail.countsForRanking ? detail.total - a.scoreDetail.total : 0

  const d = db()
  await d.batch([
    d
      .update(attemptAnswer)
      .set({ score, gradedBy: 'checklist' })
      .where(and(eq(attemptAnswer.attemptId, a.id), eq(attemptAnswer.itemId, itemId), isNull(attemptAnswer.score))),
    d.update(attempt).set({ accuracy: detail.accuracy, points: detail.total, scoreDetail: detail }).where(eq(attempt.id, a.id)),
    ...(delta ? [d.insert(pointsLedger).values({ userId, attemptId: a.id, points: delta, reason: `ajuste:correcao:${itemId}` }).onConflictDoNothing()] : []),
  ])
  return { answer: answerView({ ...row, score, gradedBy: 'checklist' }, true), score: detail, delta }
}

/* --------------------------------- histórico --------------------------------- */

export async function listSimulados(userId: string, limit = 30): Promise<HistoryItem[]> {
  const rows = await db().select().from(attempt).where(eq(attempt.userId, userId)).orderBy(desc(attempt.startedAt)).limit(limit)
  return rows.map((a) => {
    const cfg = configOf(a)
    return {
      id: a.id,
      mode: a.mode,
      status: a.finishedAt ? 'finalizado' : 'em_andamento',
      questions: a.questionIds.length,
      accuracy: a.accuracy,
      points: a.points,
      countsForRanking: a.countsForRanking,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      title: `${cfg.mode === 'prova' ? 'Prova' : 'Treino'} · ${a.questionIds.length} ${a.questionIds.length === 1 ? 'questão' : 'questões'}${cfg.topics?.length ? ` · ${cfg.topics.slice(0, 2).join(', ')}` : ''}`,
    }
  })
}
