import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, schema } from '../db/client'
import { getRanking } from '../services/ranking'
import { cleanupTestUsers, createTestUser } from './helpers/db'

/** SC-003 (spec 001 › US3): quem desativou "Aparecer no ranking" some para os outros, mas vê a si mesmo. */

afterAll(cleanupTestUsers)

describe('ranking e privacidade (SC-003)', () => {
  it('opt-out some do ranking de terceiros e aparece para si; nome de exibição é usado', async () => {
    const hidden = await createTestUser('oculto', 'Nome Real Oculto')
    const visible = await createTestUser('visivel', 'Nome Real Visível')
    await db().update(schema.profile).set({ showInRanking: false }).where(eq(schema.profile.userId, hidden))
    await db().update(schema.profile).set({ displayName: 'Apelido Visível', institution: 'UFX' }).where(eq(schema.profile.userId, visible))
    await db().insert(schema.pointsLedger).values([
      { userId: hidden, points: 500, reason: 'teste' },
      { userId: visible, points: 300, reason: 'teste' },
    ])

    const forVisible = await getRanking(visible, null, 1000)
    expect(forVisible.some((r) => r.userId === hidden)).toBe(false)
    const me = forVisible.find((r) => r.userId === visible)
    expect(me).toMatchObject({ name: 'Apelido Visível', institution: 'UFX', points: 300, me: true })

    const forHidden = await getRanking(hidden, null, 1000)
    expect(forHidden.find((r) => r.userId === hidden)).toMatchObject({ points: 500, me: true })
    expect(forHidden.find((r) => r.userId === visible)).toMatchObject({ me: false })
  })
})
