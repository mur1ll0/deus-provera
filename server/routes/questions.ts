import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { questionInput, questionListQuery } from '../../shared/schemas/question'
import { requireUser, type AppEnv } from '../middleware'
import { createQuestion, deleteQuestion, getQuestion, listQuestions, updateQuestion } from '../services/questions'

/**
 * Banco de questões — spec 002 (US5 cadastro manual) e docs/04-arquitetura.md § API.
 * Questão = enunciado + perguntas (+ alternativas). Validação compartilhada em shared/schemas/question.ts.
 */

/** Erros de validação no formato padrão `{ error }` (primeira mensagem, já em pt-BR). */
const validationHook = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    const issues = (result.error as z.ZodError).issues
    throw new HTTPException(400, { message: issues[0]?.message ?? 'Dados inválidos.' })
  }
}

const idParam = z.object({ id: z.uuid({ error: 'Questão não encontrada.' }) })
const userId = (c: { get: (k: 'user') => AppEnv['Variables']['user'] }) => c.get('user')!.id

export const questionsRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', zValidator('query', questionListQuery, validationHook), async (c) => c.json(await listQuestions(userId(c), c.req.valid('query'))))
  .get('/:id', zValidator('param', idParam, validationHook), async (c) => c.json(await getQuestion(userId(c), c.req.valid('param').id)))
  .post('/', zValidator('json', questionInput, validationHook), async (c) => c.json(await createQuestion(userId(c), c.req.valid('json')), 201))
  .put('/:id', zValidator('param', idParam, validationHook), zValidator('json', questionInput, validationHook), async (c) =>
    c.json(await updateQuestion(userId(c), c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', zValidator('param', idParam, validationHook), async (c) => {
    await deleteQuestion(userId(c), c.req.valid('param').id)
    return c.body(null, 204)
  })

export type QuestionsRoutes = typeof questionsRoutes
