import { z } from 'zod'

/**
 * Formato de importação v2 — contrato público.
 *
 * Questão = ENUNCIADO + 1..N PERGUNTAS, cada pergunta com a sua resposta
 * (discursiva: resposta_esperada + pontos_chave; objetiva: alternativas).
 *
 * É o JSON que:
 *  - o pipeline de IA (OpenRouter) produz a partir do texto do PDF;
 *  - o agente externo do usuário (ChatGPT, Claude, Gemini…) produz com o prompt de
 *    shared/prompts/external-agent.ts;
 *  - o cadastro manual também gera internamente.
 *
 * Chaves em português porque o usuário pode ler/editar este JSON.
 * Especificação completa: specs/002-importacao-questoes/contracts/import-format-v2.md
 */

export const IMPORT_FORMAT_VERSION = '2.0'

export const LIMITS = {
  maxQuestionsPerImport: 300,
  maxItemsPerQuestion: 12,
  stem: 12000,
  prompt: 3000,
  alternative: 1500,
  answer: 12000,
  keyPoint: 300,
  taxonomy: 80,
} as const

const trimmed = (max: number) => z.string().trim().min(1).max(max)
const optText = (max: number) => z.string().trim().max(max).optional().nullable()
/**
 * Texto curto TOLERANTE: agentes de IA às vezes escrevem assuntos/rótulos longos
 * ("Câncer de colo avançado: tratamento, obstrução ureteral e…"). Em vez de rejeitar a
 * importação inteira, trunca (achado da avaliação com os PDFs reais — docs/10).
 */
const lenient = (max: number) =>
  z
    .string()
    .trim()
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s))
    .optional()
    .nullable()

export const importAlternativeSchema = z.object({
  texto: trimmed(LIMITS.alternative),
  correta: z.boolean(),
  explicacao: optText(LIMITS.answer),
  gerada_por_ia: z.boolean().optional(),
})

/** Rótulo de pergunta sem a pontuação que a tela já põe ("b)" → "b", "(c)" → "c", "2." → "2"); vazio vira null. */
export function cleanItemLabel(label: string | null | undefined): string | null {
  const s = (label ?? '').trim().replace(/^\(/, '').replace(/[).:\-–—\s]+$/u, '').trim()
  return s || null
}

export const importItemSchema = z
  .object({
    /** "a", "b", "1"… — omita/nulo na pergunta única. */
    rotulo: z.string().trim().max(10).optional().nullable(),
    /** Texto da pergunta. Pode ser vazio na pergunta única (o enunciado já é a pergunta). */
    texto: z.string().trim().max(LIMITS.prompt).default(''),
    tipo: z.enum(['objetiva', 'discursiva']),
    resposta_esperada: optText(LIMITS.answer),
    pontos_chave: z.array(trimmed(LIMITS.keyPoint)).max(15).optional().nullable(),
    alternativas: z.array(importAlternativeSchema).max(8).optional().nullable(),
  })
  .superRefine((it, ctx) => {
    const alts = it.alternativas ?? []
    // Objetiva exige alternativas; discursiva PODE ter (ex.: geradas por IA) — se tiver, mesmas regras.
    if (it.tipo === 'objetiva' || alts.length > 0) {
      if (alts.length < 2) ctx.addIssue({ code: 'custom', path: ['alternativas'], message: 'Informe ao menos 2 alternativas.' })
      const corretas = alts.filter((a) => a.correta).length
      if (corretas !== 1) ctx.addIssue({ code: 'custom', path: ['alternativas'], message: `As alternativas precisam ter exatamente 1 correta (encontradas: ${corretas}).` })
    }
    if (it.tipo === 'discursiva' && !it.resposta_esperada) {
      ctx.addIssue({ code: 'custom', path: ['resposta_esperada'], message: 'Pergunta discursiva precisa de resposta esperada.' })
    }
  })

export const importQuestionSchema = z
  .object({
    area: trimmed(LIMITS.taxonomy).describe('Ex.: Medicina, Matemática, Psicologia'),
    disciplina: trimmed(LIMITS.taxonomy).describe('Ex.: Ginecologia, Cálculo'),
    assunto: lenient(LIMITS.taxonomy),
    /** Rótulo no material (ex.: "QUESTÃO 8"). */
    rotulo: lenient(40),
    /** Caso clínico / texto-base / comando principal. */
    enunciado: trimmed(LIMITS.stem),
    perguntas: z.array(importItemSchema).min(1).max(LIMITS.maxItemsPerQuestion),
    dificuldade: z.enum(['facil', 'media', 'dificil']).optional().nullable(),
    tem_imagem: z.boolean().optional().nullable(),
    descricao_imagem: optText(2000),
    pagina: z.number().int().positive().optional().nullable(),
  })
  .superRefine((q, ctx) => {
    if (q.perguntas.length > 1 && q.perguntas.some((p) => !p.texto)) {
      ctx.addIssue({ code: 'custom', path: ['perguntas'], message: 'Com mais de uma pergunta, todas precisam de texto.' })
    }
  })

export const importFileSchema = z.object({
  versao: z.literal(IMPORT_FORMAT_VERSION, { error: 'Use "versao": "2.0" (formato com enunciado + perguntas). Copie o prompt atualizado.' }),
  origem: z
    .object({
      arquivo: z.string().max(200).optional().nullable(),
      observacoes: z.string().max(2000).optional().nullable(),
    })
    .optional()
    .nullable(),
  questoes: z.array(importQuestionSchema).min(1).max(LIMITS.maxQuestionsPerImport),
})

export type ImportAlternative = z.infer<typeof importAlternativeSchema>
export type ImportItem = z.infer<typeof importItemSchema>
export type ImportQuestion = z.infer<typeof importQuestionSchema>
export type ImportFile = z.infer<typeof importFileSchema>

export interface ImportValidationResult {
  ok: boolean
  data?: ImportFile
  errors: { path: string; message: string }[]
}

/**
 * Aceita JSON puro ou JSON dentro de blocos ```json … ``` (comum em respostas de chatbots).
 * Vários blocos (resposta em "Parte 1/3, 2/3…") são unidos em um único arquivo.
 */
export function parseImportText(raw: string): ImportValidationResult {
  const blocks = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim())
  const candidates = blocks.length ? blocks : [raw.trim()]
  let json: unknown
  try {
    const parsed = candidates.map((c) => JSON.parse(c) as { versao?: unknown; origem?: unknown; questoes?: unknown[] })
    json =
      parsed.length === 1
        ? parsed[0]
        : { versao: parsed[0]?.versao, origem: parsed[0]?.origem, questoes: parsed.flatMap((p) => (Array.isArray(p?.questoes) ? p.questoes : [])) }
  } catch (e) {
    return { ok: false, errors: [{ path: '(raiz)', message: `JSON inválido: ${(e as Error).message}` }] }
  }
  const parsed = importFileSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 50).map((i) => ({
        path: i.path.join('.') || '(raiz)',
        message: i.message,
      })),
    }
  }
  return { ok: true, data: parsed.data, errors: [] }
}
