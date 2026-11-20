import { existsSync, readFileSync, rmSync } from 'node:fs'

/** Apaga o usuário de teste e tudo dele (tentativas antes das questões; o resto em cascata). */
export default async function globalTeardown() {
  for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)
  if (!existsSync('e2e/.auth/user.json')) return
  const { userId } = JSON.parse(readFileSync('e2e/.auth/user.json', 'utf8')) as { userId: string }
  const { db, schema } = await import('../server/db/client')
  const { eq } = await import('drizzle-orm')
  await db().delete(schema.attempt).where(eq(schema.attempt.userId, userId))
  await db().delete(schema.user).where(eq(schema.user.id, userId))
  await db().delete(schema.discipline).where(eq(schema.discipline.name, 'Disciplina E2E'))
  rmSync('e2e/.auth', { recursive: true, force: true })
}
