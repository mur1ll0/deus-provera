/**
 * Seed grande + medição (spec 004 › T003/T026): N estudantes com lançamentos em 8 semanas e um estudante
 * "pesado" com centenas de respostas; mede o p95 do ranking (SC-001) e do painel (SC-002).
 *
 *   npm run db:seed:large                         → usa SEED_DATABASE_URL ou TEST_DATABASE_URL (branch do Neon)
 *   npm run db:seed:large -- --users 500          → mais estudantes
 *   npm run db:seed:large -- --shared-db-ok       → no banco do .env (o mesmo da produção!): usuários fora do
 *                                                   ranking, questões privadas e TUDO apagado no fim
 *   npm run db:seed:large -- --keep               → não apaga no fim (só em banco separado)
 *   npm run db:seed:large -- --cleanup            → só apaga os dados "seed-large-*"
 */
import { existsSync } from 'node:fs'

for (const file of ['.env.local', '.env']) if (existsSync(file)) process.loadEnvFile(file)

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const num = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) || def : def
}

const shared = process.env.DATABASE_URL
const target = process.env.SEED_DATABASE_URL || process.env.TEST_DATABASE_URL
const onShared = !target || target === shared
if (onShared && !flag('shared-db-ok') && !flag('cleanup')) {
  console.error('✗ Sem SEED_DATABASE_URL/TEST_DATABASE_URL: o único banco é o do .env (o mesmo da produção).')
  console.error('  Crie um branch no Neon e defina TEST_DATABASE_URL, ou rode com --shared-db-ok (mede e apaga tudo no fim).')
  process.exit(1)
}
if (!onShared) process.env.DATABASE_URL = target

const PREFIX = 'seed-large-'
const USERS = num('users', 200)
const keep = flag('keep') && !onShared

const { db, schema } = await import('./client')
const { like, eq } = await import('drizzle-orm')
const { getRanking } = await import('../services/ranking')
const { getDashboard } = await import('../services/stats')
const { rankingPeriodStart } = await import('../../shared/simulado')

async function cleanup() {
  const users = await db().select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `${PREFIX}%`))
  // Tentativas antes das questões (attempt_question/answer apontam para a questão sem cascade).
  for (const u of users) await db().delete(schema.attempt).where(eq(schema.attempt.userId, u.id))
  await db().delete(schema.user).where(like(schema.user.id, `${PREFIX}%`))
  console.log(`✓ limpeza: ${users.length} usuários seed-large removidos (em cascata)`)
}

if (flag('cleanup')) {
  await cleanup()
  process.exit(0)
}

const DAY = 86_400_000
const rand = (n: number) => Math.floor(Math.random() * n)
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]

async function timeIt<T>(n: number, fn: () => Promise<T>) {
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    await fn()
    ms.push(performance.now() - t)
  }
  const sorted = [...ms].sort((a, b) => a - b)
  return { p50: Math.round(sorted[Math.floor(sorted.length / 2)]), p95: Math.round(p95(ms)) }
}

try {
  const [area] = await db().select().from(schema.area).limit(1)
  const [disc] = await db().select().from(schema.discipline).where(eq(schema.discipline.areaId, area.id)).limit(1)
  if (!area || !disc) throw new Error('Rode `npm run db:seed` antes (áreas/disciplinas).')
  const t0 = performance.now()

  // 1. Estudantes + perfis (fora do ranking no banco compartilhado)
  const users = Array.from({ length: USERS }, (_, i) => ({ id: `${PREFIX}${i}`, name: `Estudante Seed ${i}`, email: `${PREFIX}${i}@example.invalid`, emailVerified: true }))
  for (const c of chunk(users, 500)) await db().insert(schema.user).values(c)
  for (const c of chunk(users, 500)) await db().insert(schema.profile).values(c.map((u) => ({ userId: u.id, displayName: u.name, showInRanking: !onShared })))

  // 2. Lançamentos em 8 semanas (~30 por estudante)
  const ledger = users.flatMap((u) =>
    Array.from({ length: 30 }, () => ({ userId: u.id, points: 20 + rand(400), reason: 'seed', areaId: area.id, createdAt: new Date(Date.now() - rand(56) * DAY) })),
  )
  for (const c of chunk(ledger, 1000)) await db().insert(schema.pointsLedger).values(c)

  // 3. Estudante "pesado": 60 questões, 30 simulados finalizados com 10 questões cada (300 respostas)
  const heavy = users[0].id
  const [group] = await db().insert(schema.questionGroup).values({ ownerId: heavy, areaId: area.id, disciplineId: disc.id, topic: 'Seed' }).returning()
  const questions = Array.from({ length: 60 }, (_, i) => ({
    id: crypto.randomUUID(),
    ownerId: heavy,
    groupId: group.id,
    areaId: area.id,
    disciplineId: disc.id,
    topic: `Assunto ${i % 6}`,
    stem: `Questão seed ${i}`,
    origin: 'manual' as const,
    contentHash: crypto.randomUUID(),
  }))
  await db().insert(schema.question).values(questions)
  const items = questions.map((q) => ({ id: crypto.randomUUID(), questionId: q.id, position: 0, type: 'objetiva' as const }))
  await db().insert(schema.questionItem).values(items)
  for (let a = 0; a < 30; a++) {
    const picked = Array.from({ length: 10 }, (_, i) => questions[(a * 7 + i) % questions.length])
    const finishedAt = new Date(Date.now() - rand(28) * DAY)
    const [att] = await db()
      .insert(schema.attempt)
      .values({ userId: heavy, mode: a % 3 ? 'treino' : 'prova', config: { mode: 'treino', topics: [] }, questionIds: picked.map((q) => q.id), startedAt: new Date(finishedAt.getTime() - 600_000), finishedAt, totalTimeMs: 600_000, accuracy: 0.6, points: 100, countsForRanking: true })
      .returning()
    await db().insert(schema.attemptQuestion).values(picked.map((q, position) => ({ attemptId: att.id, questionId: q.id, position, timeMs: 60_000 })))
    await db()
      .insert(schema.attemptAnswer)
      .values(picked.map((q) => ({ attemptId: att.id, questionId: q.id, itemId: items.find((it) => it.questionId === q.id)!.id, presentedAs: 'objetiva' as const, score: Math.random() < 0.6 ? 1 : 0, gradedBy: 'auto' as const })))
  }
  console.log(`✓ seed: ${USERS} estudantes, ${ledger.length} lançamentos, 300 respostas do estudante pesado em ${Math.round((performance.now() - t0) / 1000)} s`)

  // 4. Medição (servidor → Neon; na Vercel soma-se a latência da função)
  const runs = num('runs', 15)
  const rows = [
    ['Ranking semana', await timeIt(runs, () => getRanking(heavy, rankingPeriodStart('semana')))],
    ['Ranking geral', await timeIt(runs, () => getRanking(heavy, null))],
    ['Ranking por área', await timeIt(runs, () => getRanking(heavy, null, 50, area.id))],
    ['Painel (estudante pesado)', await timeIt(runs, () => getDashboard(heavy))],
  ] as const
  console.log(`\n| Consulta (${USERS} estudantes, ${ledger.length} lançamentos) | p50 (ms) | p95 (ms) |\n|---|---|---|`)
  for (const [name, r] of rows) console.log(`| ${name} | ${r.p50} | ${r.p95} |`)
} finally {
  if (!keep) await cleanup()
}
