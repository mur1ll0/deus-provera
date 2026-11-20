import type { AnswerFormat, AnswerKind, Question, QuestionItem } from './domain'

/**
 * Regras do simulado compartilhadas entre cliente (prévia) e servidor (oficial).
 * Spec: specs/003-simulados/spec.md
 */

/** Minutos sugeridos por PERGUNTA no tempo automático (modo prova). */
export const MINUTES_PER = { objetiva: 2, discursiva: 6 } as const
export const MIN_AUTO_TIME_MIN = 5

/** Pergunta com alternativas utilizáveis (≥ 2 e exatamente 1 correta). */
export function hasValidAlternatives(item: Pick<QuestionItem, 'alternatives'>): boolean {
  const alts = item.alternatives ?? []
  return alts.length >= 2 && alts.filter((a) => a.correct).length === 1
}

/** Como a PERGUNTA é respondida no simulado, dado o formato escolhido. */
export function presentAs(item: Pick<QuestionItem, 'type' | 'alternatives' | 'expectedAnswer'>, format: AnswerFormat): AnswerKind {
  const mc = hasValidAlternatives(item)
  if (format === 'multipla') return mc ? 'objetiva' : 'discursiva'
  if (format === 'discursiva') return item.type === 'objetiva' && mc && !item.expectedAnswer ? 'objetiva' : 'discursiva'
  return item.type === 'objetiva' && mc ? 'objetiva' : 'discursiva'
}

/** A QUESTÃO pode entrar num simulado com esse formato? */
export function isEligible(q: Pick<Question, 'items'>, format: AnswerFormat): boolean {
  if (!q.items.length) return false
  if (format === 'multipla') return q.items.every(hasValidAlternatives)
  if (format === 'discursiva') return q.items.every((i) => !!i.expectedAnswer?.trim())
  return q.items.every((i) => hasValidAlternatives(i) || !!i.expectedAnswer?.trim())
}

/** Tempo limite automático: 2 min por pergunta objetiva + 6 min por discursiva, mínimo de 5 min. */
export function autoTimeLimitMin(kinds: AnswerKind[]): number {
  const total = kinds.reduce((acc, k) => acc + MINUTES_PER[k], 0)
  return Math.max(MIN_AUTO_TIME_MIN, total)
}

/** Início do período do ranking em UTC, considerando o fuso de Brasília (UTC−3, sem horário de verão). */
export function rankingPeriodStart(period: 'semana' | 'mes' | 'geral', now = new Date()): Date | null {
  if (period === 'geral') return null
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
  const local = new Date(now.getTime() - BRT_OFFSET_MS) // "relógio" de Brasília representado em UTC
  let startLocal: Date
  if (period === 'semana') {
    const daysSinceMonday = (local.getUTCDay() + 6) % 7
    startLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday))
  } else {
    startLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1))
  }
  return new Date(startLocal.getTime() + BRT_OFFSET_MS)
}
