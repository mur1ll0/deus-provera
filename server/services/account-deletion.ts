import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'

/**
 * Exclusão de conta (spec 001 › US4, FR-010; LGPD art. 18).
 *
 * `DELETE FROM user` remove em cascata sessões, contas, perfil, questões (+ perguntas/alternativas),
 * cards, importações, tentativas (+ respostas) e pontos; `ai_call.user_id` vira NULL.
 *
 * Exceção: questões do usuário que OUTROS estudantes já responderam (attempt_question/attempt_answer
 * apontam para elas sem cascade). Elas não podem sumir sem quebrar o histórico alheio, então são
 * ANONIMIZADAS: conteúdo apagado, soft-delete (`deleted_at`) e dono transferido para o usuário técnico
 * "Comunidade" — o histórico de terceiros mantém só a pontuação (docs/06).
 *
 * Tudo num único `db.batch` (neon-http: atômico). Retorna quantas questões foram anonimizadas.
 */

/** Usuário técnico dono das questões anonimizadas. Sem `account`, então não faz login. */
export const COMMUNITY_USER = { id: 'comunidade', name: 'Comunidade', email: 'comunidade@deus-provera.invalid' } as const

export const REMOVED_STEM = '[Questão removida pelo autor]'

export async function deleteAccount(userId: string): Promise<{ anonymizedQuestions: number }> {
  if (userId === COMMUNITY_USER.id) throw new Error('O usuário técnico não pode ser excluído.')
  const d = db()
  const { question, questionItem, alternative, questionGroup, attempt, attemptQuestion, attemptAnswer, user } = schema

  // Questões deste usuário usadas em tentativas de OUTROS usuários.
  const usedInQuestionList = d
    .select({ id: attemptQuestion.questionId })
    .from(attemptQuestion)
    .innerJoin(attempt, eq(attempt.id, attemptQuestion.attemptId))
    .where(ne(attempt.userId, userId))
  const usedInAnswers = d
    .select({ id: attemptAnswer.questionId })
    .from(attemptAnswer)
    .innerJoin(attempt, eq(attempt.id, attemptAnswer.attemptId))
    .where(ne(attempt.userId, userId))
  const sharedIds = d
    .select({ id: question.id })
    .from(question)
    .where(and(eq(question.ownerId, userId), or(inArray(question.id, usedInQuestionList), inArray(question.id, usedInAnswers))))
  const sharedItemIds = d.select({ id: questionItem.id }).from(questionItem).where(inArray(questionItem.questionId, sharedIds))
  const sharedGroupIds = d.select({ id: question.groupId }).from(question).where(inArray(question.id, sharedIds))

  const [, , , , anonymized] = await d.batch([
    d.insert(user).values({ ...COMMUNITY_USER, emailVerified: false }).onConflictDoNothing(),
    // Os cards dessas questões também passam para a Comunidade (senão a cascata do dono os apagaria).
    d.update(questionGroup).set({ ownerId: COMMUNITY_USER.id, description: null, updatedAt: new Date() }).where(inArray(questionGroup.id, sharedGroupIds)),
    d.update(alternative).set({ text: '', explanation: null }).where(inArray(alternative.itemId, sharedItemIds)),
    d.update(questionItem).set({ prompt: '', expectedAnswer: null, keyPoints: [] }).where(inArray(questionItem.questionId, sharedIds)),
    d
      .update(question)
      .set({
        ownerId: COMMUNITY_USER.id,
        stem: REMOVED_STEM,
        summary: null,
        topic: null,
        sourceLabel: null,
        imageDescription: null,
        hasImage: false,
        visibility: 'privada',
        flags: [],
        contentHash: sql`'removida:' || ${question.id}`,
        deletedAt: sql`coalesce(${question.deletedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(inArray(question.id, sharedIds))
      .returning({ id: question.id }),
    d.delete(user).where(eq(user.id, userId)),
  ])
  return { anonymizedQuestions: anonymized.length }
}
