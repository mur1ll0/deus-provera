import { z } from 'zod'
import type { AnswerFormat, AnswerKind, Difficulty, SimuladoConfig, SimuladoMode } from '../domain'

/**
 * Contrato da API de simulados (`/api/simulados`) — spec 003, modelo v2:
 * a QUESTÃO (enunciado) é a unidade de sorteio/tempo/marcação; a PERGUNTA (item) é a unidade de resposta e pontuação.
 * Contrato detalhado: specs/003-simulados/contracts/api-simulados.md.
 */

export const simuladoConfigInput = z.object({
  mode: z.enum(['prova', 'treino']),
  scope: z.enum(['minhas', 'minhas_e_comunidade']),
  areaId: z.uuid().nullable(),
  disciplineIds: z.array(z.uuid()).max(30).default([]),
  topics: z.array(z.string().max(120)).max(30).default([]),
  answerFormat: z.enum(['original', 'multipla', 'discursiva']).default('original'),
  count: z.number().int().min(1, 'Escolha ao menos 1 questão.').max(100),
  timeLimitMin: z.number().int().min(1).max(600).nullable(),
  reveal: z.enum(['imediato', 'final']),
  aiHints: z.boolean(),
  prioritizeMistakes: z.boolean().default(false),
}) satisfies z.ZodType<SimuladoConfig, unknown>

/** Resposta a uma PERGUNTA (idempotente; a última escrita vence). */
export const answerInput = z
  .object({
    choiceId: z.uuid().nullable().optional(),
    text: z.string().max(20_000).nullable().optional(),
    /** Dica de IA pedida antes de responder (treino) — vale metade. Só liga, nunca desliga. */
    usedHint: z.literal(true).optional(),
  })
  .refine((a) => a.choiceId !== undefined || a.text !== undefined || a.usedHint, { error: 'Nada para salvar.' })

/** Tempo gasto e marcação de uma QUESTÃO. */
export const progressInput = z
  .object({
    timeMsDelta: z.number().int().min(0).max(600_000).optional(),
    flagged: z.boolean().optional(),
  })
  .refine((p) => p.timeMsDelta !== undefined || p.flagged !== undefined, { error: 'Nada para salvar.' })

/** Revelar o gabarito de uma pergunta (treino com correção imediata); `checked` = autocorreção da discursiva. */
export const revealInput = z.object({ checked: z.array(z.boolean()).max(30).optional() })

/** Correção posterior de uma discursiva pendente (resultado). */
export const gradeInput = z.object({ checked: z.array(z.boolean()).max(30) })

/* ---------------------------- Visões devolvidas pela API ---------------------------- */

export interface PublicAlternative {
  id: string
  text: string
}

/** Pergunta SEM gabarito (prova em andamento / treino antes de revelar). */
export interface PublicItem {
  id: string
  label?: string
  prompt: string
  /** Tipo original (para o selo "alternativas geradas por IA"). */
  type: AnswerKind
  /** Como responder neste simulado (shared/simulado.ts › presentAs). */
  presentAs: AnswerKind
  alternatives?: PublicAlternative[]
  /** Discursiva: há pontos de acerto para autocorreção (quantos). */
  keyPointCount: number
}

export interface PublicQuestion {
  id: string
  area: string
  discipline: string
  topic?: string
  sourceLabel?: string
  stem: string
  hasImage: boolean
  imageDescription?: string
  difficulty: Difficulty
  /** Questão do próprio usuário (vale metade — anti-farm). */
  own: boolean
  items: PublicItem[]
}

/** Gabarito de uma pergunta (após revelar no treino, ou no resultado). */
export interface ItemKey {
  itemId: string
  alternatives: { id: string; correct: boolean; explanation?: string }[]
  expectedAnswer?: string
  keyPoints: string[]
}

export interface AnswerView {
  choiceId?: string
  text?: string
  /** Só aparece depois de revelada (treino) ou no resultado. */
  score: number | null
  gradedBy?: 'auto' | 'checklist' | 'ia'
  usedHint: boolean
  revealedBeforeAnswer: boolean
  revealed: boolean
}

export interface AttemptView {
  id: string
  config: SimuladoConfig
  status: 'em_andamento' | 'finalizado'
  startedAt: string
  /** Prazo oficial (com 15 s de tolerância de rede) — null sem limite. */
  deadlineAt: string | null
  timeLimitMs: number | null
  /** Relógio do servidor no momento da resposta (o cliente corrige a diferença). */
  serverNow: string
  questions: PublicQuestion[]
  answers: Record<string, AnswerView>
  /** Gabaritos já revelados (treino). */
  keys: Record<string, ItemKey>
  timeMs: Record<string, number>
  flagged: string[]
}

export interface ScoreDetail {
  base: number
  timeBonus: number
  total: number
  accuracy: number
  countsForRanking: boolean
  /** Discursivas respondidas ainda sem nota. */
  pending: number
}

export interface ResultView extends Omit<AttemptView, 'status' | 'serverNow'> {
  status: 'finalizado'
  finishedAt: string
  totalTimeMs: number
  score: ScoreDetail
  byTopic: { discipline: string; topic: string | null; items: number; accuracy: number }[]
}

export interface RevealResult {
  key: ItemKey
  answer: AnswerView
}

export interface GradeResult {
  answer: AnswerView
  score: ScoreDetail
  /** Diferença lançada no ranking (ajuste:correcao). */
  delta: number
}

export interface HistoryItem {
  id: string
  mode: SimuladoMode
  status: 'em_andamento' | 'finalizado'
  questions: number
  accuracy: number | null
  points: number | null
  countsForRanking: boolean
  startedAt: string
  finishedAt: string | null
  title: string
}

export interface PreviewView {
  /** Questões elegíveis com os filtros (até 500). */
  available: number
  /** Assuntos disponíveis (ignorando o filtro de assunto). */
  topics: string[]
  /** Formato de cada pergunta, por questão, na ordem do sorteio (até 100) — o cliente fatia pela quantidade. */
  kinds: AnswerKind[][]
  answerFormat: AnswerFormat
}
