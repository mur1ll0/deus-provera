import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { wrapUntrusted } from '../../shared/guardrails'
import { db, schema } from '../db/client'
import { callStructured } from './client'
import { PROMPT_VERSION } from './models'
import { DISTRACTORS_SYSTEM, EXPLAIN_SYSTEM, GRADE_SYSTEM } from './prompts'
import { checkDistractors, overlap } from './quality'
import { distractorsSchema, explanationSchema, gradeSchema, type Explanation } from './schemas'

/**
 * Serviços de IA "por questão" usados no simulado (dica/explicação/correção).
 * Explicações são cacheadas e compartilhadas entre usuários: a mesma questão pública
 * explicada 1x serve a todos — essencial com a cota de 1000 req/dia dos modelos gratuitos.
 */

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40)

export interface QuestionForAi {
  id: string
  context?: string | null
  stem: string
  expectedAnswer?: string | null
  alternatives: { id: string; text: string; correct: boolean; explanation?: string | null }[]
}

export async function explainQuestion(q: QuestionForAi, userId: string): Promise<Explanation & { cached: boolean }> {
  const key = `explain:${PROMPT_VERSION}:${hash(JSON.stringify(q))}`
  const hit = await db().select().from(schema.aiCache).where(eq(schema.aiCache.key, key)).limit(1)
  if (hit[0]) return { ...(hit[0].payload as Explanation), cached: true }

  const nonce = randomUUID().slice(0, 8)
  const body = [
    q.context && `CASO: ${q.context}`,
    `ENUNCIADO: ${q.stem}`,
    ...q.alternatives.map((a) => `ALTERNATIVA id=${a.id} ${a.correct ? '[GABARITO]' : ''}: ${a.text}${a.explanation ? ` (comentário do autor: ${a.explanation})` : ''}`),
    q.expectedAnswer && `RESPOSTA ESPERADA: ${q.expectedAnswer}`,
  ]
    .filter(Boolean)
    .join('\n')

  const r = await callStructured({
    task: 'explain',
    userId,
    schema: explanationSchema,
    system: EXPLAIN_SYSTEM(nonce),
    prompt: wrapUntrusted(body, nonce),
    // Nunca contradizer o gabarito
    quality: (v) => {
      const correct = q.alternatives.find((a) => a.correct)?.id
      const said = v.por_alternativa.find((p) => p.veredito === 'correta')?.id
      return correct && said && said !== correct ? 'A alternativa marcada como correta difere do gabarito. Siga o gabarito.' : null
    },
  })
  await db().insert(schema.aiCache).values({ key, task: 'explain', model: r.model, payload: r.value }).onConflictDoNothing()
  return { ...r.value, cached: false }
}

export async function gradeDiscursive(input: { stem: string; expectedAnswer: string; keyPoints: string[]; answer: string }, userId: string) {
  const nonce = randomUUID().slice(0, 8)
  const body = `ENUNCIADO: ${input.stem}\nRESPOSTA ESPERADA: ${input.expectedAnswer}\nPONTOS-CHAVE:\n${input.keyPoints.map((k) => `- ${k}`).join('\n')}\nRESPOSTA DO ESTUDANTE:\n${input.answer}`
  const r = await callStructured({ task: 'grade', userId, schema: gradeSchema, system: GRADE_SYSTEM(nonce), prompt: wrapUntrusted(body, nonce) })
  return r.value
}

/**
 * Dica (spec 005 › T030): reaproveita a explicação cacheada da pergunta, mas devolve só a dica —
 * e descarta a dica que "entrega" a resposta (sobreposição ≥ 0,6 com a correta / resposta esperada).
 */
export async function hintFor(q: QuestionForAi, userId: string): Promise<{ hint: string; cached: boolean }> {
  const e = await explainQuestion(q, userId)
  const answer = q.alternatives.find((a) => a.correct)?.text ?? q.expectedAnswer ?? ''
  const leaks = answer && overlap(e.dica, answer) >= 0.6
  return {
    hint: leaks || !e.dica.trim() ? 'Releia o enunciado procurando o dado decisivo e elimine primeiro as alternativas que contradizem o caso.' : e.dica,
    cached: e.cached,
  }
}

export interface DistractorInput {
  id: string
  stem: string
  prompt?: string
  expectedAnswer: string
  /** Alternativa correta já escrita pelo usuário: é preservada (T037). */
  correct?: string
}

/** Distratores avulsos (editor e revisão da importação — spec 005 › T037), até 6 perguntas por chamada. */
export async function generateDistractors(items: DistractorInput[], userId: string) {
  const nonce = randomUUID().slice(0, 8)
  const r = await callStructured({
    task: 'distractors',
    userId,
    schema: distractorsSchema,
    system: DISTRACTORS_SYSTEM(nonce),
    prompt: wrapUntrusted(
      items
        .map(
          (it) =>
            `id: ${it.id}\nENUNCIADO: ${it.stem.slice(0, 1500)}\nPERGUNTA: ${it.prompt || '(o próprio enunciado)'}\nRESPOSTA ESPERADA: ${it.expectedAnswer}` +
            (it.correct ? `\nALTERNATIVA CORRETA (escrita pelo autor — use exatamente este texto em "correta"): ${it.correct}` : ''),
        )
        .join('\n---\n'),
      nonce,
    ),
    quality: checkDistractors,
  })
  const byId = new Map(items.map((i) => [i.id, i]))
  return r.value.itens
    .filter((it) => byId.has(it.id))
    .map((it) => ({ id: it.id, correct: byId.get(it.id)!.correct ?? it.correta, incorrect: it.incorretas.map((x) => ({ text: x.texto, explanation: x.explicacao })) }))
}
