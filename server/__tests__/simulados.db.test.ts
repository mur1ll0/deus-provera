import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SimuladoConfig } from '../../shared/domain'
import { questionInput } from '../../shared/schemas/question'
import { db, schema } from '../db/client'
import { createQuestion } from '../services/questions'
import { createSimulado, finishSimulado, getResult, getSimulado, gradeItem, listSimulados, previewSimulado, revealItem, saveAnswer, saveProgress } from '../services/simulados'
import { cleanupTestUsers, createTestUser, firstArea } from './helpers/db'

/**
 * Spec 003 contra o Postgres real: sorteio, sigilo do gabarito (T008), respostas, revelação no treino (T022),
 * finalização idempotente com ledger (T014/T015), resultado (T016), correção posterior (T027), prazo e escopo (T031).
 */

let me = ''
let other = ''
let areaId = ''
const objIds: string[] = []
let discId = ''

const base = (over: Partial<SimuladoConfig> = {}): SimuladoConfig => ({
  mode: 'prova',
  scope: 'minhas',
  areaId,
  disciplineIds: [],
  topics: [],
  answerFormat: 'original',
  count: 10,
  timeLimitMin: null,
  reveal: 'final',
  aiHints: false,
  prioritizeMistakes: false,
  ...over,
})

const objective = (n: number, visibility: 'privada' | 'publica' = 'privada') =>
  questionInput.parse({
    areaId,
    discipline: 'Disciplina Simulado Teste',
    topic: n % 2 ? 'Assunto A' : 'Assunto B',
    stem: `Pergunta objetiva de teste número ${n} — ${crypto.randomUUID()}`,
    items: [{ type: 'objetiva', prompt: '', alternatives: [{ text: 'Certa', correct: true, explanation: 'Porque sim' }, { text: 'Errada', correct: false }] }],
    visibility,
  })

beforeAll(async () => {
  me = await createTestUser('sim')
  other = await createTestUser('sim-outro')
  ;({ areaId } = await firstArea())
  for (let i = 0; i < 10; i++) objIds.push((await createQuestion(me, objective(i))).id)
  const disc = await createQuestion(
    me,
    questionInput.parse({
      areaId,
      discipline: 'Disciplina Simulado Teste',
      topic: 'Discursivas',
      stem: `Caso clínico discursivo de teste — ${crypto.randomUUID()}`,
      items: [{ type: 'discursiva', prompt: '', expectedAnswer: 'Resposta esperada completa', keyPoints: ['ponto 1', 'ponto 2'] }],
    }),
  )
  discId = disc.id
  // Do outro usuário: 1 pública (entra no escopo "comunidade") e 1 privada (nunca entra)
  await createQuestion(other, objective(100, 'publica'))
  await createQuestion(other, objective(101, 'privada'))
})

afterAll(async () => {
  await cleanupTestUsers()
  await db().delete(schema.discipline).where(eq(schema.discipline.name, 'Disciplina Simulado Teste'))
})

describe('simulados (spec 003)', () => {
  it('prévia e escopo: "minhas" nunca traz terceiros; comunidade só as públicas (T031)', async () => {
    const mine = await previewSimulado(me, base({ count: 50 }))
    expect(mine.available).toBe(11)
    expect(mine.topics).toEqual(['Assunto A', 'Assunto B', 'Discursivas'])
    const all = await previewSimulado(me, base({ count: 50, scope: 'minhas_e_comunidade' }))
    expect(all.available).toBe(12) // + a pública do outro, nunca a privada
    const onlyMc = await previewSimulado(me, base({ count: 50, answerFormat: 'multipla' }))
    expect(onlyMc.available).toBe(10) // discursiva sem alternativas não entra em "múltipla"
  })

  it('prévia: só as áreas/disciplinas com questões na fonte, ignorando os filtros de área/disciplina', async () => {
    const [d] = await db()
      .select({ id: schema.discipline.id })
      .from(schema.discipline)
      .where(and(eq(schema.discipline.areaId, areaId), eq(schema.discipline.name, 'Disciplina Simulado Teste')))
    const mine = await previewSimulado(me, base({ disciplineIds: [crypto.randomUUID()] }))
    expect(mine.available).toBe(0)
    expect(mine.withQuestions).toEqual({ areaIds: [areaId], disciplineIds: [d.id] })
    // Usuário sem questões: nada em "minhas"; em "comunidade", as disciplinas das questões públicas
    const empty = await createTestUser('sim-vazio')
    expect((await previewSimulado(empty, base())).withQuestions).toEqual({ areaIds: [], disciplineIds: [] })
    expect((await previewSimulado(empty, base({ scope: 'minhas_e_comunidade' }))).withQuestions.disciplineIds).toContain(d.id)
  })

  it('prova: sem gabarito em andamento, finalização idempotente com 1 lançamento no ranking', async () => {
    const { id, config } = await createSimulado(me, base({ answerFormat: 'multipla', reveal: 'imediato', aiHints: true }))
    expect(config).toMatchObject({ reveal: 'final', aiHints: false, count: 10 })
    expect(config.timeLimitMin).toBe(20) // tempo automático: 10 objetivas × 2 min

    const view = await getSimulado(me, id)
    expect(view.questions).toHaveLength(10)
    expect(JSON.stringify(view)).not.toMatch(/"correct"|"explanation"|"expectedAnswer"|"keyPoints"/) // T008

    const [q0, q1] = view.questions
    const right = (q: (typeof view.questions)[0]) => q.items[0].alternatives!.find((a) => a.text === 'Certa')!.id
    await expect(saveAnswer(me, id, q0.items[0].id, { choiceId: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 })
    await saveAnswer(me, id, q0.items[0].id, { choiceId: right(q0) })
    await saveAnswer(me, id, q1.items[0].id, { choiceId: q1.items[0].alternatives!.find((a) => a.text === 'Errada')!.id })
    expect(await saveProgress(me, id, q0.id, { timeMsDelta: 5000, flagged: true })).toMatchObject({ flagged: true })
    await expect(revealItem(me, id, q0.items[0].id)).rejects.toMatchObject({ status: 403 })
    await expect(saveAnswer(me, id, q0.items[0].id, { usedHint: true })).rejects.toMatchObject({ status: 403 })

    const s1 = await finishSimulado(me, id)
    expect(s1).toMatchObject({ accuracy: 0.1, countsForRanking: true, pending: 0 })
    // 1 acerto: 15 (média) × 3 (prova) × 0,5 (questão própria) = 22,5 → base 23 (arredondado) + bônus de tempo
    expect(s1.base).toBe(23)
    expect(await finishSimulado(me, id)).toEqual(s1) // idempotente
    const ledger = await db().select().from(schema.pointsLedger).where(eq(schema.pointsLedger.attemptId, id))
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ points: s1.total, reason: 'simulado:prova' })

    await expect(saveAnswer(me, id, q0.items[0].id, { choiceId: right(q0) })).rejects.toMatchObject({ status: 409 })
    await expect(getSimulado(me, id)).rejects.toMatchObject({ status: 409 })

    const r = await getResult(me, id)
    const { id: _id, ...detail } = s1
    expect(r.score).toEqual(detail)
    expect(r.answers[q0.items[0].id]).toMatchObject({ score: 1, gradedBy: 'auto' })
    expect(r.answers[q1.items[0].id].score).toBe(0)
    expect(r.keys[q0.items[0].id].alternatives.find((a) => a.correct)?.explanation).toBe('Porque sim')
    // limitado à duração real da tentativa no servidor (a tentativa tinha < 5 s)
    expect(r.timeMs[q0.id]).toBeGreaterThan(0)
    expect(r.timeMs[q0.id]).toBeLessThanOrEqual(Date.parse(r.finishedAt) - Date.parse(r.startedAt))
    expect(r.flagged).toEqual([q0.id])
    expect(r.byTopic.reduce((a, t) => a + t.items, 0)).toBe(10)

    const hist = await listSimulados(me)
    expect(hist.find((h) => h.id === id)).toMatchObject({ status: 'finalizado', points: s1.total, questions: 10 })
  })

  it('treino pausa ao sair: sem prazo de parede e tempo total = soma do tempo ativo por questão', async () => {
    const { id, deadlineAt } = await createSimulado(me, base({ mode: 'treino', reveal: 'final', timeLimitMin: 1 }))
    expect(deadlineAt).toBeNull()
    // Treino antigo com prazo gravado e já vencido: continua aberto (o limite vale sobre o tempo ativo).
    await db().update(schema.attempt).set({ startedAt: new Date(Date.now() - 3_600_000), deadlineAt: new Date(Date.now() - 1000) }).where(eq(schema.attempt.id, id))
    const view = await getSimulado(me, id)
    expect(view.deadlineAt).toBeNull()
    const q0 = view.questions[0]
    await saveAnswer(me, id, q0.items[0].id, { choiceId: q0.items[0].alternatives![0].id })
    await saveProgress(me, id, q0.id, { timeMsDelta: 7000 })
    await saveProgress(me, id, view.questions[1].id, { timeMsDelta: 5000 })
    await finishSimulado(me, id)
    const r = await getResult(me, id)
    expect(r.totalTimeMs).toBe(12_000) // 1 h de parede, mas só 12 s com o simulado aberto
  })

  it('treino com correção imediata: revela, trava a resposta e autocorrige a discursiva', async () => {
    const { id } = await createSimulado(me, base({ mode: 'treino', reveal: 'imediato', aiHints: true, topics: ['Discursivas', 'Assunto A'], count: 20 }))
    const view = await getSimulado(me, id)
    expect(view.questions.length).toBe(6) // 5 do Assunto A + 1 discursiva
    const disc = view.questions.find((q) => q.id === discId)!
    const obj = view.questions.find((q) => q.id !== discId)!

    // Objetiva: revela sem responder → nota 0, sem pontos (revealedBeforeAnswer)
    const r0 = await revealItem(me, id, obj.items[0].id)
    expect(r0.answer).toMatchObject({ score: 0, revealedBeforeAnswer: true, revealed: true })
    expect(r0.key.alternatives.filter((a) => a.correct)).toHaveLength(1)
    await expect(saveAnswer(me, id, obj.items[0].id, { choiceId: r0.key.alternatives[0].id })).rejects.toMatchObject({ status: 409 })

    // Discursiva: escreve, vê a resposta esperada, marca 1 de 2 pontos
    await saveAnswer(me, id, disc.items[0].id, { text: 'Minha resposta <com> ponto 1' })
    expect(disc.items[0].keyPointCount).toBe(2)
    const shown = await revealItem(me, id, disc.items[0].id)
    expect(shown.key).toMatchObject({ expectedAnswer: 'Resposta esperada completa', keyPoints: ['ponto 1', 'ponto 2'] })
    expect(shown.answer.score).toBeNull()
    const graded = await revealItem(me, id, disc.items[0].id, [true, false])
    expect(graded.answer).toMatchObject({ score: 0.5, gradedBy: 'checklist' })

    // Recarregar mostra o que já foi revelado (e só isso)
    const again = await getSimulado(me, id)
    expect(Object.keys(again.keys).sort()).toEqual([obj.items[0].id, disc.items[0].id].sort())
    const s = await finishSimulado(me, id)
    expect(s.pending).toBe(0)
  })

  it('prova com discursiva: fica pendente e a correção posterior lança a diferença (T027)', async () => {
    const { id } = await createSimulado(me, base({ count: 11 }))
    const view = await getSimulado(me, id)
    const disc = view.questions.find((q) => q.id === discId)!
    await saveAnswer(me, id, disc.items[0].id, { text: 'Resposta com ponto 1 e ponto 2' })
    const s = await finishSimulado(me, id)
    expect(s.pending).toBe(1)
    const g = await gradeItem(me, id, disc.items[0].id, [true, true])
    expect(g.answer).toMatchObject({ score: 1, gradedBy: 'checklist' })
    expect(g.score.pending).toBe(0)
    expect(g.delta).toBe(g.score.total - s.total)
    expect(g.delta).toBeGreaterThan(0)
    const adj = await db()
      .select()
      .from(schema.pointsLedger)
      .where(and(eq(schema.pointsLedger.attemptId, id), eq(schema.pointsLedger.reason, `ajuste:correcao:${disc.items[0].id}`)))
    expect(adj[0].points).toBe(g.delta)
    await expect(gradeItem(me, id, disc.items[0].id, [true, true])).rejects.toMatchObject({ status: 409 })
  })

  it('prazo encerrado → 409; outro usuário → 404; nada elegível → 422', async () => {
    const { id } = await createSimulado(me, base())
    const view = await getSimulado(me, id)
    await db().update(schema.attempt).set({ deadlineAt: new Date(Date.now() - 1000) }).where(eq(schema.attempt.id, id))
    await expect(saveAnswer(me, id, view.questions[0].items[0].id, { choiceId: view.questions[0].items[0].alternatives![0].id })).rejects.toMatchObject({ status: 409 })
    await expect(getSimulado(other, id)).rejects.toMatchObject({ status: 404 })
    await expect(createSimulado(other, base({ scope: 'minhas', areaId: null, disciplineIds: [crypto.randomUUID()] }))).rejects.toMatchObject({ status: 422 })
  })
})

describe('painel e ranking com simulados reais (spec 004)', () => {
  it('KPIs, sequência, atividade e posição batem com os simulados finalizados', async () => {
    const { getDashboard } = await import('../services/stats')
    const { getRanking } = await import('../services/ranking')
    const d = await getDashboard(me)
    const finished = await listSimulados(me)
    const done = finished.filter((h) => h.status === 'finalizado')
    expect(d.simulados).toBe(done.length)
    expect(d.points).toBe(done.reduce((a, h) => a + (h.points ?? 0), 0))
    expect(d.rank).toBeGreaterThan(0)
    expect(d.myQuestions).toBe(11)
    expect(d.answered).toBeGreaterThan(0)
    expect(d.streak.current).toBe(1)
    expect(d.activity28d).toHaveLength(28)
    expect(d.activity28d.at(-1)!.count).toBe(d.answered) // tudo foi respondido hoje
    expect(d.recent[0]).toMatchObject({ questions: expect.any(Number) })
    expect(d.grade).not.toBeNull() // ≥ 10 respostas corrigidas

    const r = await getRanking(me, null)
    expect(r.me).toMatchObject({ pos: d.rank, points: d.points, simulados: done.filter((h) => h.countsForRanking).length, me: true })
    expect(r.me!.grade).toBe(d.grade)

    // Ranking por área (T007/T018): os lançamentos levam a área predominante do simulado
    const byArea = await getRanking(me, null, 50, areaId)
    expect(byArea.me?.points).toBe(d.points)
    expect((await getRanking(me, null, 50, crypto.randomUUID())).me).toBeNull()
  })
})

describe('rotina diária (T032 / spec 005 T044)', () => {
  it('fecha como abandonada a tentativa com mais de 24 h; a rota exige CRON_SECRET', async () => {
    const { abandonStaleAttempts } = await import('../services/maintenance')
    const { id } = await createSimulado(me, base({ mode: 'treino', reveal: 'final' }))
    await db().update(schema.attempt).set({ startedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(schema.attempt.id, id))
    const fresh = await createSimulado(me, base({ mode: 'treino', reveal: 'final' }))
    expect(await abandonStaleAttempts()).toBeGreaterThanOrEqual(1)
    const hist = await listSimulados(me)
    expect(hist.find((h) => h.id === id)).toMatchObject({ status: 'abandonado', points: 0, countsForRanking: false })
    expect(hist.find((h) => h.id === fresh.id)?.status).toBe('em_andamento')
    await expect(getSimulado(me, id)).rejects.toMatchObject({ status: 409 })
    expect(await db().select().from(schema.pointsLedger).where(eq(schema.pointsLedger.attemptId, id))).toHaveLength(0)

    const { app } = await import('../app')
    const before = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    expect((await app.request('/api/cron/daily')).status).toBe(503)
    process.env.CRON_SECRET = 'segredo-de-teste-123456'
    expect((await app.request('/api/cron/daily', { headers: { authorization: 'Bearer errado' } })).status).toBe(401)
    expect((await app.request('/api/cron/daily', { headers: { authorization: 'Bearer segredo-de-teste-123456' } })).status).toBe(200)
    if (before) process.env.CRON_SECRET = before
    else delete process.env.CRON_SECRET
  })
})
