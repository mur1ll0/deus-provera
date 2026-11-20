import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'
import { contentHash } from '../../shared/content-hash'
import type { Alternative, Question, QuestionGroup, QuestionItem } from '../../shared/domain'
import type { questionListQuery, QuestionInputParsed } from '../../shared/schemas/question'
import { db, schema } from '../db/client'
import { slugify } from './taxonomy'

/**
 * Banco de questões (modelo v2: enunciado + perguntas + alternativas).
 * neon-http não tem transação interativa: as escritas de uma questão vão num único `db.batch` (atômico).
 */

const { question, questionItem, alternative, questionGroup, discipline, area } = schema

/** Perguntas + alternativas das questões, no formato do domínio. */
export async function loadItems(questionIds: string[]): Promise<Map<string, QuestionItem[]>> {
  const out = new Map<string, QuestionItem[]>()
  if (!questionIds.length) return out
  const items = await db().select().from(questionItem).where(inArray(questionItem.questionId, questionIds)).orderBy(asc(questionItem.position))
  const alts = items.length
    ? await db().select().from(alternative).where(inArray(alternative.itemId, items.map((i) => i.id))).orderBy(asc(alternative.position))
    : []
  const altsByItem = new Map<string, Alternative[]>()
  for (const a of alts) {
    const list = altsByItem.get(a.itemId) ?? []
    list.push({ id: a.id, text: a.text, correct: a.correct, explanation: a.explanation ?? undefined, source: a.source })
    altsByItem.set(a.itemId, list)
  }
  for (const it of items) {
    const list = out.get(it.questionId) ?? []
    list.push({
      id: it.id,
      label: it.label ?? undefined,
      prompt: it.prompt,
      type: it.type,
      expectedAnswer: it.expectedAnswer ?? undefined,
      keyPoints: it.keyPoints,
      alternatives: altsByItem.get(it.id),
    })
    out.set(it.questionId, list)
  }
  return out
}

type QuestionRow = typeof question.$inferSelect

function toDomain(r: QuestionRow, items: QuestionItem[]): Question {
  return {
    id: r.id,
    ownerId: r.ownerId,
    groupId: r.groupId,
    areaId: r.areaId,
    disciplineId: r.disciplineId,
    topic: r.topic ?? undefined,
    sourceLabel: r.sourceLabel ?? undefined,
    stem: r.stem,
    items,
    difficulty: r.difficulty,
    visibility: r.visibility,
    origin: r.origin,
    hasImage: r.hasImage,
    imageDescription: r.imageDescription ?? undefined,
    flags: r.flags,
    createdAt: r.createdAt.toISOString(),
  }
}

export interface QuestionList {
  questions: Question[]
  groups: QuestionGroup[]
  total: number
}

/** Lista questões visíveis ao usuário: as suas (privadas e públicas) e/ou as públicas da comunidade. */
export async function listQuestions(userId: string, f: z.output<typeof questionListQuery>): Promise<QuestionList> {
  const mine = eq(question.ownerId, userId)
  const community = and(eq(question.visibility, 'publica'), ne(question.ownerId, userId))
  const conds: (SQL | undefined)[] = [isNull(question.deletedAt), f.scope === 'minhas' ? mine : f.scope === 'comunidade' ? community : or(mine, community)]
  if (f.areaId) conds.push(eq(question.areaId, f.areaId))
  if (f.disciplineId) conds.push(eq(question.disciplineId, f.disciplineId))
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    conds.push(or(ilike(question.stem, term), ilike(question.topic, term), sql`exists (select 1 from ${questionItem} where ${questionItem.questionId} = ${question.id} and ${questionItem.prompt} ilike ${term})`))
  }
  const where = and(...conds)
  const [rows, [{ n }]] = await Promise.all([
    db().select().from(question).where(where).orderBy(desc(question.createdAt)).limit(f.limit).offset(f.offset),
    db().select({ n: sql<number>`count(*)::int` }).from(question).where(where),
  ])
  const items = await loadItems(rows.map((r) => r.id))
  const groupIds = [...new Set(rows.map((r) => r.groupId))]
  const groups = groupIds.length ? await db().select().from(questionGroup).where(inArray(questionGroup.id, groupIds)) : []
  return {
    questions: rows.map((r) => toDomain(r, items.get(r.id) ?? [])),
    groups: groups.map((g) => ({ id: g.id, ownerId: g.ownerId, areaId: g.areaId, disciplineId: g.disciplineId, topic: g.topic ?? undefined, description: g.description ?? undefined })),
    total: n,
  }
}

/** Uma questão visível ao usuário (dono ou pública). */
export async function getQuestion(userId: string, id: string): Promise<Question> {
  const [r] = await db()
    .select()
    .from(question)
    .where(and(eq(question.id, id), isNull(question.deletedAt), or(eq(question.ownerId, userId), eq(question.visibility, 'publica'))))
  if (!r) throw new HTTPException(404, { message: 'Questão não encontrada.' })
  const items = await loadItems([r.id])
  return toDomain(r, items.get(r.id) ?? [])
}

async function ownedQuestion(userId: string, id: string): Promise<QuestionRow> {
  const [r] = await db().select().from(question).where(and(eq(question.id, id), isNull(question.deletedAt)))
  // 404 também para questões de outros donos: não revela a existência.
  if (!r || r.ownerId !== userId) throw new HTTPException(404, { message: 'Questão não encontrada.' })
  return r
}

/** Área existente + disciplina por nome (criada se não existir, por slug). */
async function resolveTaxonomy(areaId: string, disciplineName: string): Promise<{ areaId: string; disciplineId: string }> {
  const [a] = await db().select({ id: area.id }).from(area).where(eq(area.id, areaId))
  if (!a) throw new HTTPException(400, { message: 'Área inválida.' })
  const slug = slugify(disciplineName)
  if (!slug) throw new HTTPException(400, { message: 'Informe a disciplina.' })
  await db().insert(discipline).values({ areaId, name: disciplineName, slug }).onConflictDoNothing()
  const [d] = await db().select({ id: discipline.id }).from(discipline).where(and(eq(discipline.areaId, areaId), eq(discipline.slug, slug)))
  return { areaId, disciplineId: d.id }
}

/** Card (Área › Disciplina · Assunto) do dono: reaproveita o existente ou cria. */
async function resolveGroup(ownerId: string, areaId: string, disciplineId: string, topic: string | undefined): Promise<string> {
  const match = and(
    eq(questionGroup.ownerId, ownerId),
    eq(questionGroup.areaId, areaId),
    eq(questionGroup.disciplineId, disciplineId),
    topic ? sql`lower(${questionGroup.topic}) = lower(${topic})` : isNull(questionGroup.topic),
  )
  const [g] = await db().select({ id: questionGroup.id }).from(questionGroup).where(match).limit(1)
  if (g) return g.id
  const [created] = await db().insert(questionGroup).values({ ownerId, areaId, disciplineId, topic: topic ?? null }).returning({ id: questionGroup.id })
  return created.id
}

async function assertNotDuplicate(ownerId: string, hash: string, exceptId?: string) {
  const [dup] = await db()
    .select({ id: question.id })
    .from(question)
    .where(and(eq(question.ownerId, ownerId), eq(question.contentHash, hash), isNull(question.deletedAt), exceptId ? ne(question.id, exceptId) : undefined))
    .limit(1)
  if (dup) throw new HTTPException(409, { message: 'Você já tem uma questão com o mesmo enunciado e perguntas.' })
}

/**
 * Linhas de perguntas/alternativas. Ids enviados pelo cliente só são reaproveitados se já pertencem
 * a ESTA questão (evita sobrescrever dados de outra questão); o resto ganha uuid novo.
 */
function buildChildRows(questionId: string, input: QuestionInputParsed, existing: { items: Set<string>; alts: Map<string, string> }) {
  const items: (typeof questionItem.$inferInsert & { id: string })[] = []
  const alts: (typeof alternative.$inferInsert & { id: string })[] = []
  input.items.forEach((it, i) => {
    const itemId = it.id && existing.items.has(it.id) ? it.id : crypto.randomUUID()
    items.push({
      id: itemId,
      questionId,
      position: i,
      label: input.items.length > 1 ? (it.label ?? String.fromCharCode(97 + i)) : (it.label ?? null),
      prompt: it.prompt,
      type: it.type,
      expectedAnswer: it.expectedAnswer ?? null,
      keyPoints: it.keyPoints,
    })
    it.alternatives.forEach((a, j) => {
      const altId = a.id && existing.alts.get(a.id) === itemId ? a.id : crypto.randomUUID()
      alts.push({ id: altId, itemId, position: j, text: a.text, correct: a.correct, explanation: a.explanation ?? null, source: a.source })
    })
  })
  return { items, alts }
}

export async function createQuestion(userId: string, input: QuestionInputParsed): Promise<Question> {
  const hash = await contentHash(input)
  await assertNotDuplicate(userId, hash)
  const tax = await resolveTaxonomy(input.areaId, input.discipline)
  const groupId = await resolveGroup(userId, tax.areaId, tax.disciplineId, input.topic)
  const id = crypto.randomUUID()
  const { items, alts } = buildChildRows(id, input, { items: new Set(), alts: new Map() })
  const d = db()
  await d.batch([
    d.insert(question).values({
      id,
      ownerId: userId,
      groupId,
      ...tax,
      topic: input.topic ?? null,
      sourceLabel: input.sourceLabel ?? null,
      stem: input.stem,
      difficulty: input.difficulty,
      visibility: input.visibility,
      origin: 'manual',
      hasImage: input.hasImage,
      imageDescription: input.imageDescription ?? null,
      contentHash: hash,
    }),
    d.insert(questionItem).values(items),
    ...(alts.length ? [d.insert(alternative).values(alts)] : []),
  ])
  return getQuestion(userId, id)
}

/** Edição completa (substitui enunciado, perguntas e alternativas). Mantém a origem. */
export async function updateQuestion(userId: string, id: string, input: QuestionInputParsed): Promise<Question> {
  const current = await ownedQuestion(userId, id)
  const hash = await contentHash(input)
  await assertNotDuplicate(userId, hash, id)
  const tax = await resolveTaxonomy(input.areaId, input.discipline)
  const sameCard = tax.disciplineId === current.disciplineId && (input.topic ?? '').toLowerCase() === (current.topic ?? '').toLowerCase()
  const groupId = sameCard ? current.groupId : await resolveGroup(userId, tax.areaId, tax.disciplineId, input.topic)

  const existingItems = await db().select({ id: questionItem.id }).from(questionItem).where(eq(questionItem.questionId, id))
  const existingAlts = existingItems.length
    ? await db().select({ id: alternative.id, itemId: alternative.itemId }).from(alternative).where(inArray(alternative.itemId, existingItems.map((i) => i.id)))
    : []
  const { items, alts } = buildChildRows(id, input, { items: new Set(existingItems.map((i) => i.id)), alts: new Map(existingAlts.map((a) => [a.id, a.itemId])) })
  const keepItems = items.map((i) => i.id)
  const keepAlts = alts.map((a) => a.id)
  const removedItems = existingItems.map((i) => i.id).filter((x) => !keepItems.includes(x))
  const removedAlts = existingAlts.map((a) => a.id).filter((x) => !keepAlts.includes(x))

  const d = db()
  try {
    await d.batch([
      d
        .update(question)
        .set({
          groupId,
          ...tax,
          topic: input.topic ?? null,
          sourceLabel: input.sourceLabel ?? null,
          stem: input.stem,
          difficulty: input.difficulty,
          visibility: input.visibility,
          hasImage: input.hasImage,
          imageDescription: input.imageDescription ?? null,
          contentHash: hash,
          updatedAt: new Date(),
        })
        .where(eq(question.id, id)),
      ...(removedAlts.length ? [d.delete(alternative).where(inArray(alternative.id, removedAlts))] : []),
      ...(removedItems.length ? [d.delete(questionItem).where(inArray(questionItem.id, removedItems))] : []),
      d
        .insert(questionItem)
        .values(items)
        .onConflictDoUpdate({
          target: questionItem.id,
          set: { position: sql`excluded.position`, label: sql`excluded.label`, prompt: sql`excluded.prompt`, type: sql`excluded.type`, expectedAnswer: sql`excluded.expected_answer`, keyPoints: sql`excluded.key_points` },
        }),
      ...(alts.length
        ? [
            d
              .insert(alternative)
              .values(alts)
              .onConflictDoUpdate({
                target: alternative.id,
                set: { position: sql`excluded.position`, text: sql`excluded.text`, correct: sql`excluded.correct`, explanation: sql`excluded.explanation`, source: sql`excluded.source` },
              }),
          ]
        : []),
    ])
  } catch (err) {
    // FK de attempt_answer: pergunta/alternativa já respondida em simulados não pode ser removida.
    if (String((err as { code?: string }).code) === '23503' || /foreign key/i.test(String(err))) {
      throw new HTTPException(409, { message: 'Esta pergunta ou alternativa já foi respondida em simulados e não pode ser removida. Edite o texto em vez de excluir.' })
    }
    throw err
  }
  return getQuestion(userId, id)
}

/** Exclusão lógica (soft-delete): preserva o histórico de simulados que usaram a questão. */
export async function deleteQuestion(userId: string, id: string): Promise<void> {
  await ownedQuestion(userId, id)
  await db().update(question).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(question.id, id))
}
