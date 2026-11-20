import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { vi } from 'vitest'
import { testId } from './db'

/**
 * Login Google SIMULADO para testes de integração (*.db.test.ts): só os endpoints do Google são falsos
 * (token + certificados); Better Auth, rotas Hono e Postgres são reais. Devolve o cookie de sessão.
 * Chame `restoreFetch()` (ou `vi.unstubAllGlobals()`) no afterAll.
 */
type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }

const cookiesFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0])

export async function installFakeGoogle(identity = { sub: testId('google-sub'), email: `${testId('login')}@example.invalid`, name: 'Estudante Integração' }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'teste', alg: 'RS256', use: 'sig' }
  let nonce: string | undefined
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const idToken = await new SignJWT({ email: identity.email, email_verified: true, name: identity.name, picture: null, ...(nonce ? { nonce } : {}) })
        .setProtectedHeader({ alg: 'RS256', kid: 'teste' })
        .setIssuer('https://accounts.google.com')
        .setAudience(process.env.GOOGLE_CLIENT_ID!)
        .setSubject(identity.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      return Response.json({ access_token: 'ya29.teste', id_token: idToken, expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile' })
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return Response.json({ keys: [jwk] })
    if (url.startsWith('https://') && !/neon\.tech/.test(url)) throw new Error(`fetch inesperado no teste: ${new URL(url).host}`)
    return realFetch(input, init)
  })

  /** Faz o fluxo OAuth completo contra o app e devolve o cabeçalho `cookie` da sessão. */
  async function login(app: App): Promise<string> {
    const start = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: process.env.BETTER_AUTH_URL! },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    })
    const authUrl = new URL(((await start.json()) as { url: string }).url)
    nonce = authUrl.searchParams.get('nonce') ?? undefined
    const callback = await app.request(`/api/auth/callback/google?code=codigo-teste&state=${authUrl.searchParams.get('state')}`, {
      headers: { cookie: cookiesFrom(start).join('; ') },
    })
    if (callback.status !== 302) throw new Error(`login simulado falhou: ${callback.status}`)
    return cookiesFrom(callback)
      .filter((c) => c.includes('session'))
      .join('; ')
  }

  return { identity, login, restoreFetch: () => vi.unstubAllGlobals() }
}
