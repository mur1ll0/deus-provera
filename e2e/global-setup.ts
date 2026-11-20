import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { serializeSignedCookie } from 'better-call'

/**
 * Sessão de teste sem Google: cria usuário + perfil + sessão no banco e assina o cookie como o Better Auth
 * (`better-auth.session_token`, HMAC com BETTER_AUTH_SECRET). Também cadastra 12 questões objetivas privadas.
 * Tudo usa o prefixo `test-db-e2e-` e é apagado em global-teardown.ts.
 */
export default async function globalSetup() {
  for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)
  const { db, schema } = await import('../server/db/client')
  const { createQuestion } = await import('../server/services/questions')
  const { questionInput } = await import('../shared/schemas/question')

  const userId = `test-db-e2e-${crypto.randomUUID().slice(0, 8)}`
  await db().insert(schema.user).values({ id: userId, name: 'Estudante E2E', email: `${userId}@example.invalid`, emailVerified: true })
  await db().insert(schema.profile).values({ userId, displayName: 'Estudante E2E', onboardedAt: new Date(), privacyAckAt: new Date() })
  const token = crypto.randomUUID().replaceAll('-', '')
  await db()
    .insert(schema.session)
    .values({ id: crypto.randomUUID(), userId, token, expiresAt: new Date(Date.now() + 86_400_000) })
  const header = await serializeSignedCookie('better-auth.session_token', token, process.env.BETTER_AUTH_SECRET!)
  const value = header.split(';')[0].split('=').slice(1).join('=')

  const [area] = await db().select().from(schema.area).limit(1)
  for (let i = 1; i <= 12; i++) {
    await createQuestion(
      userId,
      questionInput.parse({
        areaId: area.id,
        discipline: 'Disciplina E2E',
        topic: 'Assunto E2E',
        stem: `[E2E] Questão objetiva ${i}: qual alternativa está correta?`,
        items: [{ type: 'objetiva', prompt: '', alternatives: [{ text: `Certa ${i}`, correct: true }, { text: `Errada ${i}`, correct: false }] }],
      }),
    )
  }

  mkdirSync('e2e/.auth', { recursive: true })
  writeFileSync('e2e/.auth/user.json', JSON.stringify({ userId }))
  writeFileSync(
    'e2e/.auth/state.json',
    JSON.stringify({ cookies: [{ name: 'better-auth.session_token', value, domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }),
  )
}
