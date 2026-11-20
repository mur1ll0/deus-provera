import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { inspectText } from '../../shared/guardrails'
import { AiQuotaExhaustedError, AiUnavailableError } from '../ai/client'
import { generateDistractors } from '../ai/services'
import { requireUser, reserveAiRequest, type AppEnv } from '../middleware'

/**
 * IA fora do simulado (spec 005). Dica, explicação e correção ficam em /api/simulados/:id/…
 * (autorização pela tentativa — T029); aqui só o que não depende de tentativa.
 */

const text = (max: number) => z.string().max(max).transform((t) => inspectText(t).clean)

/** Distratores avulsos (T037): editor de questão e revisão da importação; até 6 perguntas por chamada = 1 requisição. */
const distractorsInput = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        stem: text(8_000),
        prompt: text(4_000).optional(),
        expectedAnswer: text(4_000).pipe(z.string().min(2, 'Informe a resposta esperada para gerar as alternativas.')),
        correct: text(2_000).optional(),
      }),
    )
    .min(1)
    .max(6, 'No máximo 6 perguntas por vez.'),
})

export const aiRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post(
    '/distractors',
    zValidator('json', distractorsInput, (r) => {
      if (!r.success) throw new HTTPException(400, { message: r.error.issues[0]?.message ?? 'Dados inválidos.' })
    }),
    async (c) => {
      const user = c.get('user')!
      await reserveAiRequest(user.id)
      try {
        return c.json({ items: await generateDistractors(c.req.valid('json').items, user.id) })
      } catch (err) {
        if (err instanceof AiQuotaExhaustedError) throw new HTTPException(429, { message: `${err.message} Você também pode escrever as alternativas no editor.` })
        if (err instanceof AiUnavailableError) throw new HTTPException(503, { message: 'IA indisponível agora. Escreva as alternativas ou tente de novo em instantes.' })
        throw err
      }
    },
  )

export type AiRoutes = typeof aiRoutes
