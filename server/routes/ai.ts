import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { inspectText } from '../../shared/guardrails'
import { AiUnavailableError } from '../ai/client'
import { explainQuestion, gradeDiscursive } from '../ai/services'
import { db, schema } from '../db/client'
import { requireUser, reserveAiRequest, type AppEnv } from '../middleware'

/** Carrega uma PERGUNTA + o enunciado da questão, respeitando dono/visibilidade. */
async function loadItem(itemId: string, userId: string) {
  const q = schema.question
  const [row] = await db()
    .select({ item: schema.questionItem, stem: q.stem })
    .from(schema.questionItem)
    .innerJoin(q, eq(q.id, schema.questionItem.questionId))
    .where(and(eq(schema.questionItem.id, itemId), isNull(q.deletedAt), or(eq(q.ownerId, userId), eq(q.visibility, 'publica'))))
  return row
}

/** Dicas/explicações e correção por IA durante o simulado (apenas modo treino ou após finalizar). */
export const aiRoutes = new Hono<AppEnv>()
  .use(requireUser)

  .post('/explain/:itemId', async (c) => {
    const user = c.get('user')!
    const row = await loadItem(c.req.param('itemId'), user.id)
    if (!row) throw new HTTPException(404)
    // TODO(spec 005 T029): exigir tentativa ativa em modo treino com aiHints, ou tentativa finalizada com esta pergunta (403 na prova).
    const alts = await db().select().from(schema.alternative).where(eq(schema.alternative.itemId, row.item.id)).orderBy(asc(schema.alternative.position))
    await reserveAiRequest(user.id)
    try {
      return c.json(
        await explainQuestion(
          { id: row.item.id, context: row.stem, stem: row.item.prompt || row.stem, expectedAnswer: row.item.expectedAnswer, alternatives: alts },
          user.id,
        ),
      )
    } catch (err) {
      if (err instanceof AiUnavailableError) throw new HTTPException(503, { message: 'IA indisponível agora. Mostrando o comentário do autor.' })
      throw err
    }
  })

  .post('/grade', async (c) => {
    const user = c.get('user')!
    const body = z.object({ itemId: z.string().uuid(), answer: z.string().min(1).max(8000) }).safeParse(await c.req.json())
    if (!body.success) throw new HTTPException(400)
    const row = await loadItem(body.data.itemId, user.id)
    if (!row?.item.expectedAnswer) throw new HTTPException(404)
    const g = inspectText(body.data.answer)
    await reserveAiRequest(user.id)
    return c.json(
      await gradeDiscursive(
        { stem: `${row.stem}\n${row.item.prompt}`.trim(), expectedAnswer: row.item.expectedAnswer, keyPoints: row.item.keyPoints, answer: g.clean },
        user.id,
      ),
    )
  })
