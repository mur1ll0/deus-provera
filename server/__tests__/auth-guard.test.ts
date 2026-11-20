import { beforeAll, describe, expect, it } from 'vitest'

/**
 * SC-002 (spec 001): toda rota de dados responde 401 sem sessão.
 * Percorre as rotas REGISTRADAS no app (uma rota nova sem requireUser quebra este teste).
 * Sem cookie, o Better Auth não consulta o banco — por isso as variáveis abaixo podem ser fictícias.
 */

const PUBLIC = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/me$/]
const UUID = '00000000-0000-4000-8000-000000000000'

let app: { routes: { method: string; path: string }[]; request: (path: string, init?: RequestInit) => Response | Promise<Response> }

beforeAll(async () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://teste:teste@localhost.invalid/teste',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'teste',
    GOOGLE_CLIENT_SECRET: 'teste',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || 'teste',
  })
  ;({ app } = await import('../app'))
})

describe('proteção das rotas (SC-002)', () => {
  it('rotas de dados exigem sessão', async () => {
    const routes = app.routes.filter((r) => r.method !== 'ALL' && !r.path.includes('*') && !PUBLIC.some((p) => p.test(r.path)))
    expect(routes.length).toBeGreaterThan(5)
    const paths = routes.map((r) => `${r.method} ${r.path}`)
    expect(paths).toContain('GET /api/questions')
    expect(paths).toContain('POST /api/questions')
    expect(paths).toContain('PUT /api/questions/:id')
    expect(paths).toContain('DELETE /api/questions/:id')

    for (const r of routes) {
      const path = r.path.replace(/:[a-zA-Z]+/g, UUID)
      const res = await app.request(path, { method: r.method, headers: { 'content-type': 'application/json' }, body: ['GET', 'HEAD'].includes(r.method) ? undefined : '{}' })
      expect(res.status, `${r.method} ${r.path}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Faça login para continuar.' })
    }
  })

  it('GET /api/me nunca responde 401 (FR-003)', async () => {
    const res = await app.request('/api/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null, profile: null })
  })
})
