import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { contentHash } from '../../shared/content-hash'
import type { CommitResult, ImportCommitParsed } from '../../shared/schemas/import-commit'
import { db, schema } from '../db/client'
import { slugify } from './taxonomy'

/**
 * Commit da importação (spec 002 › Confirmação; T024/T025/T048). Contrato: contracts/api-imports.md.
 *
 * 1. Taxonomia: área e disciplina por slug (criadas se não existirem — taxonomia global, idempotente).
 * 2. Card: reaproveita o `question_group` do dono com a mesma Área › Disciplina · Assunto, ou cria.
 * 3. Deduplicação por `content_hash` (enunciado + perguntas + alternativas normalizados): contra o banco
 *    do usuário e dentro do próprio lote. Duplicatas são puladas e contadas (SC-007).
 * 4. Um único `db.batch` (atômico no neon-http): cards novos, questões, perguntas, alternativas e o job
 *    vira `concluida` com o resultado em `state.commitResult` — repetir o commit devolve o mesmo resultado.
 */

const { area, discipline, questionGroup, question, questionItem, alternative, importJob } = schema

/** Neon/Postgres: até 65 535 parâmetros por comando — inserções em fatias. */
const CHUNK = 400
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK))

const key = (...parts: (string | undefined | null)[]) => parts.map((p) => (p ?? '').toLocaleLowerCase('pt-BR')).join('|')

async function resolveAreas(names: string[]): Promise<Map<string, string>> {
  const bySlug = new Map(names.map((n) => [slugify(n), n]))
  const slugs = [...bySlug.keys()].filter(Boolean)
  if (!slugs.length) return new Map()
  await db()
    .insert(area)
    .values(slugs.map((slug) => ({ slug, name: bySlug.get(slug)! })))
    .onConflictDoNothing()
  const rows = await db().select({ id: area.id, slug: area.slug }).from(area).where(inArray(area.slug, slugs))
  return new Map(rows.map((r) => [r.slug, r.id]))
}

async function resolveDisciplines(pairs: { areaId: string; name: string }[]): Promise<Map<string, string>> {
  const uniq = new Map(pairs.map((p) => [`${p.areaId}|${slugify(p.name)}`, p]))
  const values = [...uniq.values()].map((p) => ({ areaId: p.areaId, name: p.name, slug: slugify(p.name) })).filter((v) => v.slug)
  if (!values.length) return new Map()
  await db().insert(discipline).values(values).onConflictDoNothing()
  const rows = await db()
    .select({ id: discipline.id, areaId: discipline.areaId, slug: discipline.slug })
    .from(discipline)
    .where(inArray(discipline.areaId, [...new Set(values.map((v) => v.areaId))]))
  return new Map(rows.map((r) => [`${r.areaId}|${r.slug}`, r.id]))
}

type JobRow = typeof importJob.$inferSelect

export async function getOwnedJob(userId: string, jobId: string): Promise<JobRow> {
  const [job] = await db().select().from(importJob).where(and(eq(importJob.id, jobId), eq(importJob.ownerId, userId)))
  if (!job) throw new HTTPException(404, { message: 'Importação não encontrada.' })
  return job
}

export async function commitImport(userId: string, jobId: string, input: ImportCommitParsed): Promise<CommitResult> {
  const job = await getOwnedJob(userId, jobId)
  const previous = (job.state as { commitResult?: CommitResult }).commitResult
  if (job.status === 'concluida' && previous) return previous // idempotente
  if (job.status === 'processando') throw new HTTPException(409, { message: 'Importação ainda em processamento.' })
  if (job.status !== 'revisao') throw new HTTPException(409, { message: 'Esta importação não está em revisão.' })
  const origin = job.source // pdf_ia | agente_externo | manual

  // 1. Taxonomia
  const areaIds = await resolveAreas(input.cards.map((c) => c.area))
  const discIds = await resolveDisciplines(input.cards.map((c) => ({ areaId: areaIds.get(slugify(c.area))!, name: c.discipline })))

  // 2. Cards existentes do dono (reaproveitados)
  const existingGroups = await db()
    .select({ id: questionGroup.id, areaId: questionGroup.areaId, disciplineId: questionGroup.disciplineId, topic: questionGroup.topic })
    .from(questionGroup)
    .where(eq(questionGroup.ownerId, userId))
  const groupByKey = new Map(existingGroups.map((g) => [key(g.areaId, g.disciplineId, g.topic), g.id]))

  // 3. Hashes e duplicatas
  const hashes = await Promise.all(input.cards.map((c) => Promise.all(c.questions.map((q) => contentHash(q)))))
  const allHashes = [...new Set(hashes.flat())]
  const taken = new Set(
    allHashes.length
      ? (
          await db()
            .select({ h: question.contentHash })
            .from(question)
            .where(and(eq(question.ownerId, userId), isNull(question.deletedAt), inArray(question.contentHash, allHashes)))
        ).map((r) => r.h)
      : [],
  )

  const newGroups: (typeof questionGroup.$inferInsert)[] = []
  const questions: (typeof question.$inferInsert)[] = []
  const items: (typeof questionItem.$inferInsert)[] = []
  const alts: (typeof alternative.$inferInsert)[] = []
  const summary = new Map<string, CommitResult['groups'][number]>()
  let duplicates = 0

  input.cards.forEach((card, ci) => {
    const areaId = areaIds.get(slugify(card.area))!
    const disciplineId = discIds.get(`${areaId}|${slugify(card.discipline)}`)!
    const gKey = key(areaId, disciplineId, card.topic)
    let groupId = groupByKey.get(gKey)
    if (!groupId) {
      groupId = crypto.randomUUID()
      groupByKey.set(gKey, groupId)
      newGroups.push({ id: groupId, ownerId: userId, areaId, disciplineId, topic: card.topic ?? null, description: card.description ?? null })
    }
    const g = summary.get(groupId) ?? { id: groupId, area: card.area, discipline: card.discipline, topic: card.topic ?? null, count: 0 }
    summary.set(groupId, g)

    card.questions.forEach((q, qi) => {
      const hash = hashes[ci][qi]
      if (taken.has(hash)) return void duplicates++
      taken.add(hash)
      const id = crypto.randomUUID()
      questions.push({
        id,
        ownerId: userId,
        groupId,
        areaId,
        disciplineId,
        topic: card.topic ?? null,
        sourceLabel: q.sourceLabel ?? null,
        stem: q.stem,
        difficulty: q.difficulty,
        visibility: q.visibility,
        origin,
        hasImage: q.hasImage,
        imageDescription: q.imageDescription ?? null,
        flags: q.flags,
        contentHash: hash,
      })
      q.items.forEach((it, i) => {
        const itemId = crypto.randomUUID()
        items.push({
          id: itemId,
          questionId: id,
          position: i,
          label: q.items.length > 1 ? (it.label ?? String.fromCharCode(97 + i)) : (it.label ?? null),
          prompt: it.prompt,
          type: it.type,
          expectedAnswer: it.expectedAnswer ?? null,
          keyPoints: it.keyPoints,
        })
        it.alternatives.forEach((a, j) =>
          alts.push({ itemId, position: j, text: a.text, correct: a.correct, explanation: a.explanation ?? null, source: a.source }),
        )
      })
      g.count++
    })
  })

  const result: CommitResult = { saved: questions.length, duplicates, groups: [...summary.values()].filter((g) => g.count > 0) }
  const d = db()
  const usedGroups = new Set(questions.map((q) => q.groupId))
  try {
    // Postgres verifica as FKs ao fim de cada comando: o job vem primeiro só para o batch nunca ser vazio.
    await d.batch([
      // O rascunho (texto do PDF, drafts) sai do job: fica só o resultado.
      d
        .update(importJob)
        .set({ status: 'concluida', state: sql`jsonb_build_object('commitResult', ${JSON.stringify(result)}::jsonb)`, error: null, updatedAt: new Date() })
        .where(and(eq(importJob.id, job.id), eq(importJob.status, 'revisao'))),
      ...chunks(newGroups.filter((g) => usedGroups.has(g.id!))).map((rows) => d.insert(questionGroup).values(rows)),
      ...chunks(questions).map((rows) => d.insert(question).values(rows)),
      ...chunks(items).map((rows) => d.insert(questionItem).values(rows)),
      ...chunks(alts).map((rows) => d.insert(alternative).values(rows)),
    ])
  } catch (err) {
    // Corrida com outro commit do mesmo usuário (índice único dono+hash): devolve o que já foi gravado.
    if (/question_owner_hash|unique/i.test(String((err as Error).message))) {
      const again = await getOwnedJob(userId, jobId)
      const r = (again.state as { commitResult?: CommitResult }).commitResult
      if (r) return r
      throw new HTTPException(409, { message: 'Algumas questões já foram salvas por outra importação. Recarregue e tente de novo.' })
    }
    throw err
  }
  return result
}
