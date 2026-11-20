import type { Difficulty, ItemAnswer, SimuladoMode } from './domain'

/**
 * Regras de pontuação — fonte da verdade: docs/07-pontuacao-e-ranking.md
 * Mesma função roda no cliente (prévia) e no servidor (valor oficial gravado).
 * A unidade de pontuação é a PERGUNTA (cada subitem de uma questão pontua separadamente).
 */

export const BASE_POINTS: Record<Difficulty, number> = {
  facil: 10,
  media: 15,
  dificil: 20,
}

export const MODE_MULTIPLIER: Record<SimuladoMode, number> = {
  prova: 3,
  treino: 1,
}

/** Peso da nota de discursivas conforme quem corrigiu. Autocorreção vale menos (é autodeclarada). */
export const GRADER_WEIGHT = {
  auto: 1,
  ia: 1,
  checklist: 0.5,
} as const

export const ANTI_FARM = {
  /** Questões criadas pelo próprio usuário valem metade. */
  ownQuestion: 0.5,
  /** Mesma questão respondida de novo em menos de 7 dias. */
  repeatedWithin7d: 0.25,
  /** Dica de IA usada antes de responder (treino). */
  hintUsed: 0.5,
  /** Viu a resposta antes de responder (treino): não pontua. */
  revealedBefore: 0,
}

export const PROVA_RULES = {
  minQuestions: 10,
  /** Bônus máximo por terminar com tempo sobrando (fração dos pontos ganhos). */
  maxTimeBonus: 0.2,
}

export interface QuestionScoreInput {
  /** Resposta a uma pergunta (item). */
  answer: Pick<ItemAnswer, 'score' | 'gradedBy' | 'revealedBeforeAnswer' | 'usedHint'>
  difficulty: Difficulty
  mode: SimuladoMode
  isOwnQuestion: boolean
  repeatedRecently: boolean
}

export function scoreQuestion(i: QuestionScoreInput): number {
  const { answer } = i
  if (answer.score == null || answer.score <= 0) return 0
  let pts = BASE_POINTS[i.difficulty] * answer.score
  pts *= GRADER_WEIGHT[answer.gradedBy ?? 'auto']
  pts *= MODE_MULTIPLIER[i.mode]
  if (i.isOwnQuestion) pts *= ANTI_FARM.ownQuestion
  if (i.repeatedRecently) pts *= ANTI_FARM.repeatedWithin7d
  if (i.mode === 'treino') {
    if (answer.revealedBeforeAnswer) pts *= ANTI_FARM.revealedBefore
    if (answer.usedHint) pts *= ANTI_FARM.hintUsed
  }
  return pts
}

export interface SimuladoScoreInput {
  mode: SimuladoMode
  /** Uma entrada por PERGUNTA respondida (ou não) no simulado. */
  questions: QuestionScoreInput[]
  /** Nº de QUESTÕES (enunciados) do simulado — base da regra de mínimo da prova. Padrão: questions.length. */
  questionCount?: number
  timeLimitMs: number | null
  totalTimeMs: number
}

export interface SimuladoScore {
  base: number
  timeBonus: number
  total: number
  accuracy: number
  countsForRanking: boolean
}

export function scoreSimulado(s: SimuladoScoreInput): SimuladoScore {
  const base = s.questions.reduce((acc, q) => acc + scoreQuestion(q), 0)
  const graded = s.questions.filter((q) => q.answer.score != null)
  const accuracy = graded.length ? graded.reduce((a, q) => a + (q.answer.score ?? 0), 0) / graded.length : 0

  let timeBonus = 0
  if (s.mode === 'prova' && s.timeLimitMs && s.totalTimeMs < s.timeLimitMs) {
    const remaining = (s.timeLimitMs - s.totalTimeMs) / s.timeLimitMs
    // Bônus só faz sentido com bom desempenho: escala pela acurácia para não premiar "chutar e entregar".
    timeBonus = base * PROVA_RULES.maxTimeBonus * remaining * accuracy
  }

  const countsForRanking = s.mode === 'treino' || (s.questionCount ?? s.questions.length) >= PROVA_RULES.minQuestions
  return {
    base: Math.round(base),
    timeBonus: Math.round(timeBonus),
    total: Math.round(base + timeBonus),
    accuracy,
    countsForRanking,
  }
}

/**
 * Nota de desempenho (0–10): acurácia ponderada dos últimos 30 dias.
 * Questões de prova pesam 2, de treino pesam 1.
 */
export function performanceGrade(items: { score: number; mode: SimuladoMode }[]): number {
  if (!items.length) return 0
  let num = 0
  let den = 0
  for (const it of items) {
    const w = it.mode === 'prova' ? 2 : 1
    num += it.score * w
    den += w
  }
  return Math.round((num / den) * 100) / 10
}
