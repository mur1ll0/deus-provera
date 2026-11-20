import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toCommitInput } from '../../shared/schemas/import-commit'
import { db, schema } from '../db/client'
import { cleanupTestUsers } from './helpers/db'
import { installFakeGoogle } from './helpers/google-login'

/**
 * Fluxo HTTP do commit (T023/T024/T027/T048) pelas rotas reais, com sessão real (login Google simulado):
 * agente externo → job em revisão → commit com erro (400 + itens) → commit válido → idempotente → lista.
 */

let app: (typeof import('../app'))['app']
let cookie = ''
let restore = () => {}

const payload = {
  versao: '2.0',
  origem: { arquivo: 'lista-teste.pdf' },
  questoes: [
    {
      area: 'Medicina',
      disciplina: 'Ginecologia',
      assunto: 'Prolapso genital',
      enunciado: 'Qual o ponto de referência zero do POP-Q?',
      perguntas: [{ tipo: 'objetiva', alternativas: [{ texto: 'Carúncula himenal', correta: true }, { texto: 'Colo uterino', correta: false }] }],
    },
  ],
}

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeAll(async () => {
  ;({ app } = await import('../app'))
  const google = await installFakeGoogle()
  restore = google.restoreFetch
  cookie = await google.login(app)
})

afterAll(async () => {
  restore()
  await cleanupTestUsers()
})

describe('rotas de importação: agente externo → commit', () => {
  it('cria o job, valida, grava, é idempotente e aparece na lista', async () => {
    const created = await app.request('/api/imports', json('POST', { source: 'agente_externo', payload }))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string; status: string }

    // GET devolve o JSON validado para montar a revisão
    const view = (await (await app.request(`/api/imports/${id}`, json('GET'))).json()) as { status: string; payload: typeof payload }
    expect(view.status).toBe('revisao')
    expect(view.payload.questoes).toHaveLength(1)

    const card = { area: 'Medicina', discipline: 'Ginecologia', topic: 'Prolapso genital', questionIds: ['q'] }
    const good = {
      stem: payload.questoes[0].enunciado,
      items: [{ prompt: '', type: 'objetiva' as const, alternatives: [{ text: 'Carúncula himenal', correct: true, source: 'usuario' as const }, { text: 'Colo uterino', correct: false, source: 'usuario' as const }] }],
      difficulty: 'media' as const,
      visibility: 'privada' as const,
    }

    // Autosave da revisão (T042): guarda e devolve no GET enquanto em revisão
    const draft = { cards: [{ id: 'c1', area: 'Medicina', discipline: 'Ginecologia', topic: 'Editado', description: '', questionIds: ['q'] }], drafts: { q: { id: 'q', stem: 'editado' } }, source: 'agente_externo' }
    expect((await app.request(`/api/imports/${id}/draft`, json('PATCH', { review: draft }))).status).toBe(200)
    const reopened = (await (await app.request(`/api/imports/${id}`, json('GET'))).json()) as { reviewDraft: typeof draft }
    expect(reopened.reviewDraft).toEqual(draft)

    // 400 com a lista de problemas por card/questão — nada é gravado
    const bad = toCommitInput([card], { q: { ...good, items: [{ ...good.items[0], alternatives: [{ ...good.items[0].alternatives[0] }] }] } }).body
    const r400 = await app.request(`/api/imports/${id}/commit`, json('POST', bad))
    expect(r400.status).toBe(400)
    expect(await r400.json()).toMatchObject({ items: [{ card: 0, question: 0, message: expect.stringMatching(/2 alternativas/) }] })

    const ok = await app.request(`/api/imports/${id}/commit`, json('POST', toCommitInput([card], { q: good }).body))
    expect(ok.status).toBe(200)
    const result = (await ok.json()) as { saved: number; duplicates: number; groups: { id: string }[] }
    expect(result).toMatchObject({ saved: 1, duplicates: 0 })

    const again = await app.request(`/api/imports/${id}/commit`, json('POST', toCommitInput([card], { q: good }).body))
    expect(await again.json()).toEqual(result)

    // A questão está no banco do usuário, com origem agente_externo
    const list = (await (await app.request('/api/questions?scope=minhas', json('GET'))).json()) as { questions: { stem: string; origin: string }[] }
    expect(list.questions).toEqual([expect.objectContaining({ stem: good.stem, origin: 'agente_externo' })])

    const jobs = (await (await app.request('/api/imports', json('GET'))).json()) as { jobs: { id: string; status: string; fileName: string }[] }
    expect(jobs.jobs.find((j) => j.id === id)).toMatchObject({ status: 'concluida', fileName: 'lista-teste.pdf' })
    const [row] = await db().select().from(schema.importJob).where(eq(schema.importJob.id, id))
    expect(Object.keys(row.state)).toEqual(['commitResult'])
    expect((await app.request(`/api/imports/${id}/draft`, json('PATCH', { review: draft }))).status).toBe(409)
    // Já salva: não dá para remover (T063)
    expect((await app.request(`/api/imports/${id}`, json('DELETE'))).status).toBe(409)
  })

  it('remover importação não salva (T063): cancelada, estado apagado, idempotente, só do dono', async () => {
    const created = await app.request('/api/imports', json('POST', { source: 'agente_externo', payload }))
    const { id } = (await created.json()) as { id: string }
    await app.request(`/api/imports/${id}/draft`, json('PATCH', { review: { cards: [], drafts: {}, source: 'agente_externo' } }))

    const anon = await app.request(`/api/imports/${id}`, { method: 'DELETE' })
    expect(anon.status).toBe(401)

    const del = await app.request(`/api/imports/${id}`, json('DELETE'))
    expect(del.status).toBe(200)
    const [row] = await db().select().from(schema.importJob).where(eq(schema.importJob.id, id))
    expect(row).toMatchObject({ status: 'cancelada', state: {} })

    expect((await app.request(`/api/imports/${id}`, json('DELETE'))).status).toBe(200) // idempotente
    expect((await app.request(`/api/imports/${id}/draft`, json('PATCH', { review: { cards: [], drafts: {}, source: 'agente_externo' } }))).status).toBe(409)
    expect((await app.request(`/api/imports/${id}/commit`, json('POST', { cards: [] }))).status).not.toBe(200)
    expect((await app.request('/api/imports/00000000-0000-0000-0000-000000000000', json('DELETE'))).status).toBe(404)
  })

  it('lote manual: cria job "manual" e salva pelo mesmo commit; sem sessão → 401', async () => {
    const created = await app.request('/api/imports', json('POST', { source: 'manual' }))
    expect(created.status).toBe(201)
    const { id, status } = (await created.json()) as { id: string; status: string }
    expect(status).toBe('revisao')
    const body = toCommitInput([{ area: 'Medicina', discipline: 'Ginecologia', questionIds: ['m'] }], {
      m: { stem: 'Cite dois fatores de risco para prolapso genital.', items: [{ prompt: '', type: 'discursiva', expectedAnswer: 'Multiparidade e idade.' }], difficulty: 'facil', visibility: 'privada' },
    }).body
    const r = await app.request(`/api/imports/${id}/commit`, json('POST', body))
    expect(await r.json()).toMatchObject({ saved: 1, duplicates: 0 })

    const anon = await app.request(`/api/imports/${id}/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(anon.status).toBe(401)
  })
})
