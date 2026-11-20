import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { answerInput, gradeInput, progressInput, revealInput, simuladoConfigInput } from '../../shared/schemas/simulado'
import { requireUser, type AppEnv } from '../middleware'
import {
  createSimulado,
  finishSimulado,
  getResult,
  getSimulado,
  gradeItem,
  listSimulados,
  previewSimulado,
  revealItem,
  saveAnswer,
  saveProgress,
} from '../services/simulados'

/**
 * Simulados (spec 003). Contrato: specs/003-simulados/contracts/api-simulados.md.
 * Regras (sorteio, prazo, sigilo do gabarito, pontuação) em server/services/simulados.ts.
 */

const validationHook = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) throw new HTTPException(400, { message: (result.error as z.ZodError).issues[0]?.message ?? 'Dados inválidos.' })
}
const uuid = z.uuid({ error: 'Não encontrado.' })
const idParam = z.object({ id: uuid })
const itemParam = z.object({ id: uuid, itemId: uuid })
const questionParam = z.object({ id: uuid, questionId: uuid })
const uid = (c: { get: (k: 'user') => AppEnv['Variables']['user'] }) => c.get('user')!.id

export const simuladosRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', async (c) => c.json({ items: await listSimulados(uid(c)) }))
  .post('/preview', zValidator('json', simuladoConfigInput, validationHook), async (c) => c.json(await previewSimulado(uid(c), c.req.valid('json'))))
  .post('/', zValidator('json', simuladoConfigInput, validationHook), async (c) => c.json(await createSimulado(uid(c), c.req.valid('json')), 201))
  .get('/:id', zValidator('param', idParam, validationHook), async (c) => c.json(await getSimulado(uid(c), c.req.valid('param').id)))
  .put('/:id/answers/:itemId', zValidator('param', itemParam, validationHook), zValidator('json', answerInput, validationHook), async (c) => {
    const p = c.req.valid('param')
    return c.json(await saveAnswer(uid(c), p.id, p.itemId, c.req.valid('json')))
  })
  .put('/:id/questions/:questionId', zValidator('param', questionParam, validationHook), zValidator('json', progressInput, validationHook), async (c) => {
    const p = c.req.valid('param')
    return c.json(await saveProgress(uid(c), p.id, p.questionId, c.req.valid('json')))
  })
  .post('/:id/reveal/:itemId', zValidator('param', itemParam, validationHook), zValidator('json', revealInput, validationHook), async (c) => {
    const p = c.req.valid('param')
    return c.json(await revealItem(uid(c), p.id, p.itemId, c.req.valid('json').checked))
  })
  .post('/:id/finish', zValidator('param', idParam, validationHook), async (c) => c.json(await finishSimulado(uid(c), c.req.valid('param').id)))
  .get('/:id/result', zValidator('param', idParam, validationHook), async (c) => c.json(await getResult(uid(c), c.req.valid('param').id)))
  .post('/:id/grade/:itemId', zValidator('param', itemParam, validationHook), zValidator('json', gradeInput, validationHook), async (c) => {
    const p = c.req.valid('param')
    return c.json(await gradeItem(uid(c), p.id, p.itemId, c.req.valid('json').checked))
  })

export type SimuladosRoutes = typeof simuladosRoutes
