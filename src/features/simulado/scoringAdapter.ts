import type { Question, SimuladoAttempt } from '@shared/domain'
import { scoreSimulado, type SimuladoScore } from '@shared/scoring'
import { presentAs } from '@shared/simulado'

/** Converte a tentativa em entrada das regras oficiais de pontuação (shared/scoring.ts) — uma entrada por PERGUNTA. */
export function computeAttemptScore(attempt: SimuladoAttempt, byId: Map<string, Question>, meId: string): SimuladoScore {
  const qs = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean) as Question[]
  return scoreSimulado({
    mode: attempt.config.mode,
    timeLimitMs: attempt.config.timeLimitMin ? attempt.config.timeLimitMin * 60_000 : null,
    totalTimeMs: attempt.totalTimeMs,
    questionCount: qs.length,
    questions: qs.flatMap((q) =>
      q.items.map((it) => ({
        answer: attempt.answers[it.id] ?? { score: 0 },
        difficulty: q.difficulty,
        mode: attempt.config.mode,
        isOwnQuestion: q.ownerId === meId,
        repeatedRecently: false,
      })),
    ),
  })
}

/** Corrige automaticamente as perguntas respondidas como múltipla escolha; discursivas em branco valem 0. */
export function autoGrade(attempt: SimuladoAttempt, byId: Map<string, Question>): SimuladoAttempt {
  const answers = { ...attempt.answers }
  for (const qid of attempt.questionIds) {
    const q = byId.get(qid)
    if (!q) continue
    for (const it of q.items) {
      const a = answers[it.id] ?? { itemId: it.id, score: null }
      if (presentAs(it, attempt.config.answerFormat) === 'objetiva') {
        const correct = it.alternatives?.find((x) => x.correct)?.id
        answers[it.id] = { ...a, score: a.choiceId ? (a.choiceId === correct ? 1 : 0) : 0, gradedBy: 'auto' }
      } else if (!a.text?.trim() && a.score == null) {
        answers[it.id] = { ...a, score: 0, gradedBy: 'auto' } // em branco
      } else {
        answers[it.id] = a
      }
    }
  }
  return { ...attempt, answers }
}
