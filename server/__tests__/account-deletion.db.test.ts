import { eq, inArray, or } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, schema } from '../db/client'
import { COMMUNITY_USER, deleteAccount, REMOVED_STEM } from '../services/account-deletion'
import { cleanupTestUsers, createTestUser, firstArea } from './helpers/db'

/**
 * SC-004 (spec 001 › US4): a exclusão não deixa NENHUMA linha com o user_id excluído;
 * questões públicas usadas por outros ficam anonimizadas (Comunidade + soft-delete) e o histórico
 * do outro estudante mantém a pontuação.
 */

const sharedQuestionIds: string[] = []

afterAll(async () => {
  // A questão anonimizada pertence à Comunidade: apagar as tentativas do outro usuário (cleanup) e a questão.
  await cleanupTestUsers()
  if (sharedQuestionIds.length) {
    const groups = await db().select({ id: schema.question.groupId }).from(schema.question).where(inArray(schema.question.id, sharedQuestionIds))
    await db().delete(schema.question).where(inArray(schema.question.id, sharedQuestionIds))
    if (groups.length) await db().delete(schema.questionGroup).where(inArray(schema.questionGroup.id, groups.map((g) => g.id)))
  }
})

async function makeQuestion(ownerId: string, visibility: 'publica' | 'privada', stem: string) {
  const { areaId, disciplineId } = await firstArea()
  const [g] = await db().insert(schema.questionGroup).values({ ownerId, areaId, disciplineId, topic: 'Teste' }).returning()
  const [q] = await db()
    .insert(schema.question)
    .values({ ownerId, groupId: g.id, areaId, disciplineId, stem, visibility, origin: 'manual', contentHash: crypto.randomUUID() })
    .returning()
  const [item] = await db().insert(schema.questionItem).values({ questionId: q.id, position: 0, type: 'objetiva', expectedAnswer: 'B' }).returning()
  const [alt] = await db()
    .insert(schema.alternative)
    .values([
      { itemId: item.id, position: 0, text: 'A segredo', correct: false },
      { itemId: item.id, position: 1, text: 'B segredo', correct: true },
    ])
    .returning()
  return { q, item, alt }
}

async function answer(userId: string, qs: Awaited<ReturnType<typeof makeQuestion>>, points: number) {
  const [a] = await db()
    .insert(schema.attempt)
    .values({ userId, mode: 'prova', config: {}, questionIds: [qs.q.id], points, accuracy: 1, finishedAt: new Date(), countsForRanking: true })
    .returning()
  await db().insert(schema.attemptQuestion).values({ attemptId: a.id, questionId: qs.q.id, position: 0, timeMs: 1000 })
  await db().insert(schema.attemptAnswer).values({ attemptId: a.id, itemId: qs.item.id, questionId: qs.q.id, presentedAs: 'objetiva', choiceId: qs.alt.id, score: 1, gradedBy: 'auto' })
  await db().insert(schema.pointsLedger).values({ userId, attemptId: a.id, points, reason: 'simulado' })
  return a
}

describe('exclusão de conta (SC-004)', () => {
  it('remove todos os dados do usuário e anonimiza questões usadas por outros', async () => {
    const victim = await createTestUser('excluir', 'Fulano Excluído')
    const other = await createTestUser('outro', 'Outro Estudante')

    const shared = await makeQuestion(victim, 'publica', 'Enunciado público com dados do autor')
    const priv = await makeQuestion(victim, 'privada', 'Enunciado privado')
    sharedQuestionIds.push(shared.q.id)

    await answer(victim, priv, 10) // tentativa do próprio usuário
    const otherAttempt = await answer(other, shared, 20) // outro estudante respondeu a questão pública
    await db().insert(schema.session).values({ id: crypto.randomUUID(), userId: victim, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) })
    await db().insert(schema.account).values({ id: crypto.randomUUID(), userId: victim, providerId: 'google', accountId: `sub-${victim}` })
    await db().insert(schema.importJob).values({ ownerId: victim, source: 'pdf_ia', fileName: 'lista.pdf' })
    const [call] = await db().insert(schema.aiCall).values({ userId: victim, task: 'teste', model: 'teste:free', ok: true, latencyMs: 1 }).returning()

    const result = await deleteAccount(victim)
    expect(result.anonymizedQuestions).toBe(1)

    // Nenhuma linha com o user_id excluído
    const s = schema
    const leftovers = await Promise.all([
      db().select().from(s.user).where(eq(s.user.id, victim)),
      db().select().from(s.profile).where(eq(s.profile.userId, victim)),
      db().select().from(s.session).where(eq(s.session.userId, victim)),
      db().select().from(s.account).where(eq(s.account.userId, victim)),
      db().select().from(s.question).where(eq(s.question.ownerId, victim)),
      db().select().from(s.questionGroup).where(eq(s.questionGroup.ownerId, victim)),
      db().select().from(s.attempt).where(eq(s.attempt.userId, victim)),
      db().select().from(s.pointsLedger).where(eq(s.pointsLedger.userId, victim)),
      db().select().from(s.importJob).where(eq(s.importJob.ownerId, victim)),
      db().select().from(s.aiCall).where(eq(s.aiCall.userId, victim)),
    ])
    expect(leftovers.map((r) => r.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

    // Questão privada (só usada pelo próprio usuário) foi apagada de vez
    expect(await db().select().from(s.question).where(eq(s.question.id, priv.q.id))).toHaveLength(0)

    // Questão pública usada por outro: anonimizada, soft-delete, dona = Comunidade
    const [q] = await db().select().from(s.question).where(eq(s.question.id, shared.q.id))
    expect(q).toMatchObject({ ownerId: COMMUNITY_USER.id, stem: REMOVED_STEM, visibility: 'privada' })
    expect(q.deletedAt).not.toBeNull()
    const alts = await db().select().from(s.alternative).where(or(eq(s.alternative.itemId, shared.item.id)))
    expect(alts.every((a) => a.text === '' && a.explanation === null)).toBe(true)
    const [item] = await db().select().from(s.questionItem).where(eq(s.questionItem.id, shared.item.id))
    expect(item).toMatchObject({ prompt: '', expectedAnswer: null, keyPoints: [] })

    // Histórico do outro estudante intacto (pontuação mantida)
    const [oa] = await db().select().from(s.attempt).where(eq(s.attempt.id, otherAttempt.id))
    expect(oa.points).toBe(20)
    const [ans] = await db().select().from(s.attemptAnswer).where(eq(s.attemptAnswer.attemptId, otherAttempt.id))
    expect(ans.score).toBe(1)

    // Telemetria de IA anonimizada (user_id → NULL)
    const [c] = await db().select().from(s.aiCall).where(eq(s.aiCall.id, call.id))
    expect(c.userId).toBeNull()
    await db().delete(s.aiCall).where(eq(s.aiCall.id, call.id))

    // Mesmo Google pode criar conta nova depois (o e-mail ficou livre)
    const again = await db().select().from(s.user).where(eq(s.user.email, `${victim}@example.invalid`))
    expect(again).toHaveLength(0)
  })

  it('o usuário técnico não pode ser excluído', async () => {
    await expect(deleteAccount(COMMUNITY_USER.id)).rejects.toThrow()
  })
})
