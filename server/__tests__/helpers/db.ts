import { inArray, like } from 'drizzle-orm'
import { db, schema } from '../../db/client'

/**
 * Utilitários dos testes de integração com o Postgres real (`npm run test:db`, arquivos *.db.test.ts).
 * Todo dado criado usa ids/e-mails com o prefixo `test-db-` e é removido no fim de cada arquivo.
 * Use `TEST_DATABASE_URL` (branch descartável do Neon) para não tocar o banco de desenvolvimento.
 */

export const TEST_PREFIX = 'test-db-'

export function testId(tag: string) {
  return `${TEST_PREFIX}${tag}-${crypto.randomUUID().slice(0, 8)}`
}

export async function createTestUser(tag: string, name = 'Teste Integração') {
  const id = testId(tag)
  await db().insert(schema.user).values({ id, name, email: `${id}@example.invalid`, emailVerified: true })
  await db().insert(schema.profile).values({ userId: id, displayName: name }).onConflictDoNothing()
  return id
}

export async function firstArea() {
  const [a] = await db().select().from(schema.area).limit(1)
  const [d] = await db().select().from(schema.discipline).where(inArray(schema.discipline.areaId, [a.id])).limit(1)
  if (!a || !d) throw new Error('Rode `npm run db:seed` antes dos testes de integração.')
  return { areaId: a.id, disciplineId: d.id }
}

/** Remove usuários de teste (cascata) — inclusive de execuções anteriores interrompidas. */
export async function cleanupTestUsers() {
  await db().delete(schema.user).where(like(schema.user.id, `${TEST_PREFIX}%`))
  await db().delete(schema.user).where(like(schema.user.email, `${TEST_PREFIX}%`))
}
