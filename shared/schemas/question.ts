import { z } from 'zod'
import { normalizeText } from '../guardrails'

/**
 * Contrato da API de questões (`/api/questions`) — modelo v2: ENUNCIADO + PERGUNTAS.
 * Usado no servidor (validação) e no cliente (mesmas regras do editor). Spec 002 › US5.
 */

/** Texto do usuário: normaliza (guardrails) e apara. */
const text = (max: number) => z.string().max(max * 2).transform((s) => normalizeText(s).trim()).pipe(z.string().max(max))
const optText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .nullish()
    .transform((s) => (s == null ? undefined : normalizeText(s).trim() || undefined))
    .pipe(z.string().max(max).optional())

export const QUESTION_LIMITS = {
  stem: 20_000,
  prompt: 8_000,
  answer: 8_000,
  alternative: 2_000,
  explanation: 4_000,
  keyPoint: 500,
  keyPoints: 20,
  alternatives: 8,
  items: 20,
} as const

export const alternativeInput = z.object({
  /** Id existente (edição). Ids desconhecidos são ignorados e geram uma nova alternativa. */
  id: z.string().max(64).optional(),
  text: text(QUESTION_LIMITS.alternative),
  correct: z.boolean(),
  explanation: optText(QUESTION_LIMITS.explanation),
  source: z.enum(['usuario', 'ia']).default('usuario'),
})

export const itemInput = z
  .object({
  id: z.string().max(64).optional(),
  label: optText(8),
  prompt: text(QUESTION_LIMITS.prompt).default(''),
  type: z.enum(['objetiva', 'discursiva']),
  expectedAnswer: optText(QUESTION_LIMITS.answer),
  keyPoints: z
    .array(z.string().max(QUESTION_LIMITS.keyPoint * 2))
    .max(QUESTION_LIMITS.keyPoints * 2)
    .default([])
    .transform((ks) => ks.map((k) => normalizeText(k).trim()).filter(Boolean))
    .pipe(z.array(z.string().max(QUESTION_LIMITS.keyPoint)).max(QUESTION_LIMITS.keyPoints)),
  /** Alternativas vazias (texto em branco) são descartadas (transform abaixo). */
  alternatives: z.array(alternativeInput).max(QUESTION_LIMITS.alternatives * 2).default([]),
}).transform((it) => ({ ...it, alternatives: it.alternatives.filter((a) => a.text) }))

export const questionInput = z
  .object({
    areaId: z.uuid({ error: 'Escolha a área.' }),
    /** Nome da disciplina — criada na área se ainda não existir (taxonomia global). */
    discipline: text(80).pipe(z.string().min(2, 'Informe a disciplina.')),
    /** Assunto amplo (tema da aula). */
    topic: optText(120),
    sourceLabel: optText(60),
    stem: text(QUESTION_LIMITS.stem).pipe(z.string().min(5, 'Escreva o enunciado.')),
    items: z.array(itemInput).min(1, 'A questão precisa de pelo menos uma pergunta.').max(QUESTION_LIMITS.items),
    difficulty: z.enum(['facil', 'media', 'dificil']).default('media'),
    visibility: z.enum(['privada', 'publica']).default('privada'),
    hasImage: z.boolean().default(false),
    imageDescription: optText(4_000),
  })
  .superRefine((q, ctx) => {
    for (const msg of itemErrors(q.items)) ctx.addIssue({ code: 'custom', message: msg, path: ['items'] })
  })

export type QuestionInput = z.input<typeof questionInput>
export type QuestionInputParsed = z.output<typeof questionInput>

type ItemLike = { label?: string; prompt: string; type: 'objetiva' | 'discursiva'; expectedAnswer?: string } & {
  alternatives?: { text: string; correct: boolean }[]
}

/** Regras por pergunta (as mesmas do editor): mensagens em pt-BR prontas para exibir. */
export function itemErrors(items: ItemLike[]): string[] {
  const errors: string[] = []
  items.forEach((it, i) => {
    const name = items.length > 1 ? `Pergunta ${it.label ?? i + 1}` : 'Resposta'
    const alts = (it.alternatives ?? []).filter((a) => a.text.trim())
    if (items.length > 1 && !it.prompt.trim()) errors.push(`${name}: escreva o texto da pergunta.`)
    if (alts.length > QUESTION_LIMITS.alternatives) errors.push(`${name}: no máximo ${QUESTION_LIMITS.alternatives} alternativas.`)
    if (it.type === 'objetiva' && alts.length < 2) errors.push(`${name}: múltipla escolha precisa de ao menos 2 alternativas.`)
    if (alts.length && alts.filter((a) => a.correct).length !== 1) errors.push(`${name}: marque exatamente 1 alternativa correta.`)
    if (it.type === 'discursiva' && !it.expectedAnswer?.trim()) errors.push(`${name}: informe a resposta esperada.`)
  })
  return errors
}

/** Filtros de listagem do banco de questões. */
export const questionListQuery = z.object({
  scope: z.enum(['todas', 'minhas', 'comunidade']).default('todas'),
  areaId: z.uuid().optional(),
  disciplineId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})
