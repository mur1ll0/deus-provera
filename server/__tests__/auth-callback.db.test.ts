import { eq } from 'drizzle-orm'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, schema } from '../db/client'
import { cleanupTestUsers, testId } from './helpers/db'

/**
 * T021 (spec 001 › US1): o callback do Google (simulado) cria `user`, `account`, `session` e `profile`,
 * e o cookie de sessão devolvido autentica o `/api/me`. Só os endpoints do Google são falsos;
 * Better Auth, rotas Hono e Postgres são reais.
 */

const sub = testId('google-sub')
const email = `${testId('login')}@example.invalid`
const name = 'Estudante Integração'
let app: (typeof import('../app'))['app']

beforeAll(async () => {
  ;({ app } = await import('../app'))
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'teste', alg: 'RS256', use: 'sig' }
  let nonce: string | undefined
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const idToken = await new SignJWT({ email, email_verified: true, name, picture: null, ...(nonce ? { nonce } : {}) })
        .setProtectedHeader({ alg: 'RS256', kid: 'teste' })
        .setIssuer('https://accounts.google.com')
        .setAudience(process.env.GOOGLE_CLIENT_ID!)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      return Response.json({ access_token: 'ya29.teste', id_token: idToken, expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile' })
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return Response.json({ keys: [jwk] })
    if (url.startsWith('https://')) {
      // O banco (Neon HTTP) passa direto; qualquer outra chamada externa é um erro do teste.
      if (/neon\.tech/.test(url)) return realFetch(input, init)
      throw new Error(`fetch inesperado no teste: ${new URL(url).host}`)
    }
    return realFetch(input, init)
  })
  // O nonce (se o Better Auth enviar) é capturado da URL de autorização em startLogin().
  setNonce = (n) => (nonce = n)
})

let setNonce: (n: string | undefined) => void = () => {}

afterAll(async () => {
  vi.unstubAllGlobals()
  await cleanupTestUsers()
})

const cookiesFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0])

describe('login Google (T021)', () => {
  it('callback cria user, account, session e profile; o cookie autentica /api/me', async () => {
    const origin = process.env.BETTER_AUTH_URL!
    const start = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ provider: 'google', callbackURL: '/questoes' }),
    })
    expect(start.status).toBe(200)
    const { url } = (await start.json()) as { url: string }
    const authUrl = new URL(url)
    expect(authUrl.host).toBe('accounts.google.com')
    expect(authUrl.searchParams.get('scope')?.split(' ').sort()).toEqual(expect.arrayContaining(['email', 'openid', 'profile']))
    setNonce(authUrl.searchParams.get('nonce') ?? undefined)

    const callback = await app.request(`/api/auth/callback/google?code=codigo-teste&state=${authUrl.searchParams.get('state')}`, {
      headers: { cookie: cookiesFrom(start).join('; ') },
    })
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('/questoes')
    const sessionCookies = cookiesFrom(callback).filter((c) => c.includes('session'))
    expect(sessionCookies.length).toBeGreaterThan(0)

    const [u] = await db().select().from(schema.user).where(eq(schema.user.email, email))
    expect(u).toMatchObject({ name, emailVerified: true })
    const accounts = await db().select().from(schema.account).where(eq(schema.account.userId, u.id))
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ providerId: 'google', accountId: sub })
    expect(await db().select().from(schema.session).where(eq(schema.session.userId, u.id))).toHaveLength(1)
    const [p] = await db().select().from(schema.profile).where(eq(schema.profile.userId, u.id))
    expect(p).toMatchObject({ displayName: name, showInRanking: true, onboardedAt: null })

    const me = await app.request('/api/me', { headers: { cookie: sessionCookies.join('; ') } })
    const body = (await me.json()) as { user: { id: string; email: string } | null; profile: { displayName: string } | null }
    expect(body.user).toMatchObject({ id: u.id, email })
    expect(body.profile?.displayName).toBe(name)

    // US3: PATCH /api/profile pela rota real (sessão + validação compartilhada)
    const json = (b: unknown) => ({ method: 'PATCH', headers: { cookie: sessionCookies.join('; '), 'content-type': 'application/json' }, body: JSON.stringify(b) })
    const bad = await app.request('/api/profile', json({ displayName: 'A' }))
    expect(bad.status).toBe(400)
    const patched = await app.request('/api/profile', json({ displayName: ' <b>Apelido</b> ', course: 'Medicina', showInRanking: false, onboarded: true }))
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({ displayName: 'Apelido', course: 'Medicina', institution: null, showInRanking: false, onboardedAt: expect.any(String) })
    const [p2] = await db().select().from(schema.profile).where(eq(schema.profile.userId, u.id))
    expect(p2.privacyAckAt).not.toBeNull()

    // US4: DELETE /api/account exige a confirmação digitada, apaga tudo e expira os cookies
    const del = (b: unknown) => ({ method: 'DELETE', headers: { cookie: sessionCookies.join('; '), 'content-type': 'application/json' }, body: JSON.stringify(b) })
    expect((await app.request('/api/account', del({ confirm: 'excluir' }))).status).toBe(400)
    const deleted = await app.request('/api/account', del({ confirm: 'EXCLUIR' }))
    expect(deleted.status).toBe(200)
    expect(deleted.headers.getSetCookie().some((c) => c.includes('session_token=;') && /max-age=0/i.test(c))).toBe(true)
    expect(await db().select().from(schema.user).where(eq(schema.user.id, u.id))).toHaveLength(0)
    expect(await db().select().from(schema.session).where(eq(schema.session.userId, u.id))).toHaveLength(0)
    // Sem o cache de sessão em cookie, o token antigo não autentica mais.
    const token = sessionCookies.filter((c) => c.includes('session_token'))
    const after = await app.request('/api/me', { headers: { cookie: token.join('; ') } })
    expect(((await after.json()) as { user: unknown }).user).toBeNull()
  })
})
