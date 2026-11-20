import { eq, sql } from 'drizzle-orm'
import type { ProfilePatchParsed } from '../../shared/schemas/profile'
import { db, schema } from '../db/client'

export interface Profile {
  displayName: string | null
  institution: string | null
  course: string | null
  showInRanking: boolean
  onboardedAt: string | null
}

type ProfileRow = typeof schema.profile.$inferSelect

const toProfile = (p: ProfileRow): Profile => ({
  displayName: p.displayName,
  institution: p.institution,
  course: p.course,
  showInRanking: p.showInRanking,
  onboardedAt: p.onboardedAt?.toISOString() ?? null,
})

/** Cria o perfil no primeiro login (FR-006): nome de exibição = nome do Google, aparece no ranking. */
export async function ensureProfile(userId: string, name: string): Promise<void> {
  await db().insert(schema.profile).values({ userId, displayName: name }).onConflictDoNothing()
}

export async function getProfile(userId: string, name: string): Promise<Profile> {
  const select = () => db().select().from(schema.profile).where(eq(schema.profile.userId, userId))
  let [p] = await select()
  if (!p) {
    // Usuário criado antes do hook (ou hook falhou): cria agora.
    await ensureProfile(userId, name)
    ;[p] = await select()
  }
  return toProfile(p)
}

/** PATCH /api/profile (FR-007/FR-008; T020): só os campos enviados mudam. */
export async function updateProfile(userId: string, name: string, patch: ProfilePatchParsed): Promise<Profile> {
  await ensureProfile(userId, name)
  const { onboarded, ...fields } = patch
  const [p] = await db()
    .update(schema.profile)
    .set({
      ...fields,
      // Ciência do aviso único (ranking + privacidade): grava só na primeira vez.
      ...(onboarded ? { onboardedAt: sql`coalesce(${schema.profile.onboardedAt}, now())`, privacyAckAt: sql`coalesce(${schema.profile.privacyAckAt}, now())` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.profile.userId, userId))
    .returning()
  return toProfile(p)
}
