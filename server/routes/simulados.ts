import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Alternative, QuestionItem } from '../../shared/domain'
import { scoreSimulado } from '../../shared/scoring'
import { autoTimeLimitMin, isEligible, presentAs } from '../../shared/simulado'
import { db, schema } from '../db/client'
import { requireUser, type AppEnv } from '../middleware'

/**
 * Simulados. Regras críticas ficam no SERVIDOR (o cliente só exibe):
 *  - sorteio das questões (enunciado + todas as suas perguntas) e prazo (deadline) do modo prova;
 *  - gabarito nunca é enviado antes da hora (prova: só após finalizar);
 *  - pontuação por PERGUNTA com shared/scoring.ts, gravada no points_ledger.
 */

const configSchema = z.object({
  mode: z.enum(['prova', 'treino']),
  scope: z.enum(['minhas', 'minhas_e_comunidade']),
  areaId: z.string().uuid().nullable(),
  disciplineIds: z.array(z.string().uuid()).max(30),
  topics: z.array(z.string().max(80)).max(30),
  answerFormat: z.enum(['original', 'multipla', 'discursiva']),
  count: z.number().int().min(1).max(100),
  timeLimitMin: z.number().int().min(1).max(600).nullable(),
  reveal: z.enum(['imediato', 'final']),
  aiHints: z.boolean(),
  prioritizeMistakes: z.boolean(),
})

/** Carrega perguntas + alternativas das questões, no formato do domínio (para elegibilidade/pontuação). */
async function loadItems(questionIds: string[]): Promise<Map<string, QuestionItem[]>> {
  if (!questionIds.length) return new Map()
  const items = await db().select().from(schema.questionItem).where(inArray(schema.questionItem.questionId, questionIds))
  const alts = items.length ? await db().select().from(schema.alternative).where(inArray(schema.alternative.itemId, items.map((i) => i.id))) : []
  const altsByItem = new Map<string, Alternative[]>()
  for (const a of alts.sort((x, y) => x.position - y.position)) {
    altsByItem.set(a.itemId, [...(altsByItem.get(a.itemId) ?? []), { id: a.id, text: a.text, correct: a.correct, explanation: a.explanation ?? undefined, source: a.source }])
  }
  const out = new Map<string, QuestionItem[]>()
  for (const it of items.sort((x, y) => x.position - y.position)) {
    const item: QuestionItem = {
      id: it.id,
      label: it.label ?? undefined,
      prompt: it.prompt,
      type: it.type,
      expectedAnswer: it.expectedAnswer ?? undefined,
      keyPoints: it.keyPoints,
      alternatives: altsByItem.get(it.id),
    }
    out.set(it.questionId, [...(out.get(it.questionId) ?? []), item])
  }
  return out
}

export const simuladosRoutes = new Hono<AppEnv>()
  .use(requireUser)

  .post('/', async (c) => {
    const user = c.get('user')!
    const parsed = configSchema.safeParse(await c.req.json())
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message })
    const cfg = parsed.data
    if (cfg.mode === 'prova') {
      // Prova: regras fixas, independentemente do que o cliente mandou.
      Object.assign(cfg, { reveal: 'final', aiHints: false })
    }

    const q = schema.question
    const filters = [
      isNull(q.deletedAt),
      cfg.scope === 'minhas' ? eq(q.ownerId, user.id) : or(eq(q.ownerId, user.id), eq(q.visibility, 'publica')),
      cfg.areaId ? eq(q.areaId, cfg.areaId) : undefined,
      cfg.disciplineIds.length ? inArray(q.disciplineId, cfg.disciplineIds) : undefined,
      cfg.topics.length ? inArray(q.topic, cfg.topics) : undefined,
    ].filter(Boolean)

    // Sorteia candidatos e filtra pela elegibilidade do formato de resposta (regra em shared/simulado.ts).
    // TODO(spec 003): prioritizeMistakes (join attempt_answer com score < 0.5).
    const candidates = await db()
      .select({ id: q.id })
      .from(q)
      .where(and(...filters))
      .orderBy(sql`random()`)
      .limit(cfg.count * 4)
    const itemsByQ = await loadItems(candidates.map((x) => x.id))
    const picked = candidates.filter((x) => isEligible({ items: itemsByQ.get(x.id) ?? [] }, cfg.answerFormat)).slice(0, cfg.count)
    if (!picked.length) throw new HTTPException(422, { message: 'Nenhuma questão com esses filtros e formato de resposta.' })

    if (cfg.mode === 'prova' && !cfg.timeLimitMin) {
      cfg.timeLimitMin = autoTimeLimitMin(picked.flatMap((p) => (itemsByQ.get(p.id) ?? []).map((it) => presentAs(it, cfg.answerFormat))))
    }
    const timeLimitMs = cfg.timeLimitMin ? cfg.timeLimitMin * 60_000 : null
    const [created] = await db()
      .insert(schema.attempt)
      .values({
        userId: user.id,
        mode: cfg.mode,
        config: cfg,
        questionIds: picked.map((p) => p.id),
        timeLimitMs,
        deadlineAt: timeLimitMs ? new Date(Date.now() + timeLimitMs + 15_000) : null, // 15 s de tolerância de rede
      })
      .returning()
    return c.json({ id: created.id, questionIds: created.questionIds, deadlineAt: created.deadlineAt }, 201)
  })

  .post('/:id/finish', async (c) => {
    const user = c.get('user')!
    const [a] = await db().select().from(schema.attempt).where(and(eq(schema.attempt.id, c.req.param('id')), eq(schema.attempt.userId, user.id)))
    if (!a) throw new HTTPException(404)
    if (a.finishedAt) return c.json({ id: a.id, points: a.points })

    const answers = await db().select().from(schema.attemptAnswer).where(eq(schema.attemptAnswer.attemptId, a.id))
    const answerByItem = new Map(answers.map((x) => [x.itemId, x]))
    const qs = await db().select().from(schema.question).where(inArray(schema.question.id, a.questionIds))
    const itemsByQ = await loadItems(a.questionIds)
    const finishedAt = new Date()
    const totalTimeMs = Math.min(finishedAt.getTime() - a.startedAt.getTime(), a.timeLimitMs ?? Number.MAX_SAFE_INTEGER)

    // Uma entrada por PERGUNTA de cada questão sorteada (em branco = 0).
    const score = scoreSimulado({
      mode: a.mode,
      timeLimitMs: a.timeLimitMs,
      totalTimeMs,
      questionCount: qs.length,
      questions: qs.flatMap((question) =>
        (itemsByQ.get(question.id) ?? []).map((it) => {
          const ans = answerByItem.get(it.id)
          return {
            answer: { score: ans?.score ?? 0, gradedBy: ans?.gradedBy ?? undefined, revealedBeforeAnswer: ans?.revealedBeforeAnswer, usedHint: ans?.usedHint },
            difficulty: question.difficulty,
            mode: a.mode,
            isOwnQuestion: question.ownerId === user.id,
            repeatedRecently: false, // TODO(spec 004): consultar respostas da mesma pergunta nos últimos 7 dias
          }
        }),
      ),
    })

    await db().batch([
      db().update(schema.attempt).set({ finishedAt, totalTimeMs, accuracy: score.accuracy, points: score.total, countsForRanking: score.countsForRanking }).where(eq(schema.attempt.id, a.id)),
      db().insert(schema.pointsLedger).values({ userId: user.id, attemptId: a.id, points: score.countsForRanking ? score.total : 0, reason: `simulado:${a.mode}` }),
    ])
    return c.json({ id: a.id, ...score })
  })
