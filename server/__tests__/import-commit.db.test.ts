import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importCommitInput, type ImportCommitInput } from '../../shared/schemas/import-commit'
import { db, schema } from '../db/client'
import { commitImport } from '../services/import-commit'
import { slugify } from '../services/taxonomy'
import { cleanupTestUsers, createTestUser } from './helpers/db'

/**
 * T026 (spec 002): commit da revisão no Postgres real — taxonomia por slug, cards, questões v2,
 * idempotência do job e reimportação sem duplicatas (SC-007).
 */

const NEW_AREA = `Área Teste Commit ${crypto.randomUUID().slice(0, 6)}`
let owner = ''
let other = ''

// Mesmo conteúdo do exemplo do contrato v2 (shared/__tests__/import-and-segmenter.test.ts), já como cards.
const body: ImportCommitInput = {
  cards: [
    {
      area: 'Medicina',
      discipline: 'Ginecologia',
      topic: 'Rastreio do câncer de colo',
      description: 'ASCUS e conduta',
      questions: [
        {
          sourceLabel: 'QUESTÃO 8',
          stem: 'Joana tem 45 anos… A colpocitologia mostrou ASCUS. Responda:',
          items: [
            { label: 'a', prompt: 'Há necessidade de outro exame? Justifique.', type: 'discursiva', expectedAnswer: 'Sim, DNA-HPV.', keyPoints: ['DNA-HPV'] },
            {
              label: 'b',
              prompt: 'O que significa este resultado?',
              type: 'discursiva',
              expectedAnswer: 'Achado de grau maior.',
              alternatives: [
                { text: 'Grau maior', correct: true, source: 'ia' },
                { text: 'Grau menor', correct: false, source: 'ia' },
              ],
            },
          ],
          visibility: 'publica',
          flags: ['Processado sem IA — revise'],
        },
        {
          stem: 'Ponto zero do POP-Q?',
          items: [{ prompt: '', type: 'objetiva', alternatives: [{ text: 'Hímen', correct: true }, { text: 'Colo', correct: false }] }],
        },
      ],
    },
  ],
}

async function newJob(userId: string, status: 'revisao' | 'processando' = 'revisao', source: 'agente_externo' | 'pdf_ia' | 'manual' = 'agente_externo') {
  const [j] = await db().insert(schema.importJob).values({ ownerId: userId, source, status, state: { payload: { teste: true } } }).returning()
  return j.id
}

beforeAll(async () => {
  owner = await createTestUser('commit')
  other = await createTestUser('commit-outro')
})

afterAll(async () => {
  await cleanupTestUsers()
  const [a] = await db().select().from(schema.area).where(eq(schema.area.slug, slugify(NEW_AREA)))
  if (a) {
    await db().delete(schema.discipline).where(eq(schema.discipline.areaId, a.id))
    await db().delete(schema.area).where(eq(schema.area.id, a.id))
  }
})

describe('commit da importação (T024/T026)', () => {
  it('grava cards, questões, perguntas e alternativas e conclui o job', async () => {
    const jobId = await newJob(owner)
    const r = await commitImport(owner, jobId, importCommitInput.parse(body))
    expect(r).toMatchObject({ saved: 2, duplicates: 0 })
    expect(r.groups).toEqual([expect.objectContaining({ area: 'Medicina', discipline: 'Ginecologia', topic: 'Rastreio do câncer de colo', count: 2 })])

    const qs = await db().select().from(schema.question).where(eq(schema.question.ownerId, owner))
    expect(qs).toHaveLength(2)
    expect(qs.every((q) => q.origin === 'agente_externo' && q.groupId === r.groups[0].id)).toBe(true)
    const q8 = qs.find((q) => q.sourceLabel === 'QUESTÃO 8')!
    expect(q8).toMatchObject({ visibility: 'publica', flags: ['Processado sem IA — revise'] })
    expect(qs.find((q) => q.sourceLabel === null)!.visibility).toBe('privada')

    const items = await db().select().from(schema.questionItem).where(inArray(schema.questionItem.questionId, qs.map((q) => q.id)))
    expect(items).toHaveLength(3)
    const alts = await db().select().from(schema.alternative).where(inArray(schema.alternative.itemId, items.map((i) => i.id)))
    expect(alts).toHaveLength(4)
    expect(alts.filter((a) => a.source === 'ia')).toHaveLength(2)

    const [g] = await db().select().from(schema.questionGroup).where(eq(schema.questionGroup.id, r.groups[0].id))
    expect(g).toMatchObject({ ownerId: owner, topic: 'Rastreio do câncer de colo', description: 'ASCUS e conduta' })

    const [job] = await db().select().from(schema.importJob).where(eq(schema.importJob.id, jobId))
    expect(job.status).toBe('concluida')
    expect(job.state).toEqual({ commitResult: r }) // rascunho apagado, só o resultado

    // Repetir o commit do mesmo job devolve o mesmo resultado e não grava nada (idempotente)
    expect(await commitImport(owner, jobId, importCommitInput.parse(body))).toEqual(r)
    expect(await db().select().from(schema.question).where(eq(schema.question.ownerId, owner))).toHaveLength(2)
  })

  it('reimportar o mesmo conteúdo não duplica (SC-007) e reaproveita o card', async () => {
    const r = await commitImport(owner, await newJob(owner), importCommitInput.parse(body))
    expect(r).toEqual({ saved: 0, duplicates: 2, groups: [] })
    expect(await db().select().from(schema.question).where(eq(schema.question.ownerId, owner))).toHaveLength(2)
  })

  it('duplicata dentro do mesmo lote conta uma vez; área nova é criada por slug', async () => {
    const q = body.cards[0].questions[1]
    const twice: ImportCommitInput = { cards: [{ area: NEW_AREA, discipline: 'Disciplina Nova', questions: [q, q] }] }
    const r = await commitImport(other, await newJob(other, 'revisao', 'manual'), importCommitInput.parse(twice))
    expect(r).toMatchObject({ saved: 1, duplicates: 1 })
    const [a] = await db().select().from(schema.area).where(eq(schema.area.slug, slugify(NEW_AREA)))
    expect(a.name).toBe(NEW_AREA)
    const [saved] = await db().select().from(schema.question).where(eq(schema.question.ownerId, other))
    expect(saved).toMatchObject({ areaId: a.id, origin: 'manual' })
  })

  it('job em processamento → 409; job de outro usuário → 404', async () => {
    await expect(commitImport(owner, await newJob(owner, 'processando', 'pdf_ia'), importCommitInput.parse(body))).rejects.toMatchObject({ status: 409 })
    await expect(commitImport(other, await newJob(owner), importCommitInput.parse(body))).rejects.toMatchObject({ status: 404 })
  })
})
