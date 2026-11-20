import { eq } from 'drizzle-orm'
import { db, schema } from '../db/client'

export interface Profile {
  displayName: string | null
  institution: string | null
  course: string | null
  showInRanking: boolean
  onboardedAt: string | null
}

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
  return { displayName: p.displayName, institution: p.institution, course: p.course, showInRanking: p.showInRanking, onboardedAt: p.onboardedAt?.toISOString() ?? null }
}
