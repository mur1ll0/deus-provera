import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SimuladoConfig } from '../../shared/domain'
import { questionInput } from '../../shared/schemas/question'
import { db, schema } from '../db/client'
import { generateDistractors } from '../ai/services'
import { createQuestion } from '../services/questions'
import { aiGradeItem, createSimulado, explainItem, finishSimulado, getSimulado, hintForItem, revealItem, saveAnswer } from '../services/simulados'
import { cleanupTestUsers, createTestUser, firstArea } from './helpers/db'

/**
 * Spec 005 no simulado: autorização pela tentativa (T029) sem chamar a IA; e, com AI_LIVE=1,
 * dica (T030), explicação e correção por IA (T035) com o OpenRouter real (~4 requisições).
 */

let me = ''
let areaId = ''
const LIVE = process.env.AI_LIVE === '1'

const cfg = (over: Partial<SimuladoConfig> = {}): SimuladoConfig => ({
  mode: 'treino',
  scope: 'minhas',
  areaId,
  disciplineIds: [],
  topics: [],
  answerFormat: 'original',
  count: 10,
  timeLimitMin: null,
  reveal: 'imediato',
  aiHints: true,
  prioritizeMistakes: false,
  ...over,
})

beforeAll(async () => {
  me = await createTestUser('sim-ia')
  ;({ areaId } = await firstArea())
  await createQuestion(
    me,
    questionInput.parse({
      areaId,
      discipline: 'Disciplina IA Teste',
      stem: 'Mulher de 45 anos com colpocitologia mostrando ASC-US. Qual a conduta inicial recomendada pelas diretrizes brasileiras?',
      items: [
        {
          type: 'objetiva',
          prompt: '',
          alternatives: [
            { text: 'Repetir a citologia em 6 meses', correct: true, explanation: 'Conduta das diretrizes para ASC-US acima de 30 anos.' },
            { text: 'Histerectomia total', correct: false },
            { text: 'Conização imediata', correct: false },
          ],
        },
      ],
    }),
  )
  await createQuestion(
    me,
    questionInput.parse({
      areaId,
      discipline: 'Disciplina IA Teste',
      stem: 'Cite os dois principais fatores de risco para o prolapso genital feminino.',
      items: [{ type: 'discursiva', prompt: '', expectedAnswer: 'Multiparidade (partos vaginais) e envelhecimento com hipoestrogenismo.', keyPoints: ['multiparidade', 'envelhecimento ou hipoestrogenismo'] }],
    }),
  )
})

afterAll(async () => {
  await cleanupTestUsers()
  await db().delete(schema.discipline).where(eq(schema.discipline.name, 'Disciplina IA Teste'))
})

async function itemsOf(id: string) {
  const v = await getSimulado(me, id)
  const obj = v.questions.find((q) => q.items[0].presentAs === 'objetiva')!.items[0]
  const disc = v.questions.find((q) => q.items[0].presentAs === 'discursiva')!.items[0]
  return { obj, disc }
}

describe('IA no simulado — autorização (T029)', () => {
  it('prova: sem dica nem explicação até finalizar', async () => {
    const { id } = await createSimulado(me, cfg({ mode: 'prova' }))
    const { obj, disc } = await itemsOf(id)
    await expect(hintForItem(me, id, obj.id)).rejects.toMatchObject({ status: 403 })
    await expect(explainItem(me, id, obj.id)).rejects.toMatchObject({ status: 403 })
    await saveAnswer(me, id, disc.id, { text: 'resposta' })
    await expect(aiGradeItem(me, id, disc.id)).rejects.toMatchObject({ status: 403 })
  })

  it('treino: explicação só depois de revelar; dica bloqueada depois de revelar; dicas desligadas → 403', async () => {
    const { id } = await createSimulado(me, cfg())
    const { obj, disc } = await itemsOf(id)
    await expect(explainItem(me, id, obj.id)).rejects.toMatchObject({ status: 403 })
    await revealItem(me, id, obj.id)
    await expect(hintForItem(me, id, obj.id)).rejects.toMatchObject({ status: 409 })
    await expect(aiGradeItem(me, id, disc.id)).rejects.toMatchObject({ status: 400 }) // sem texto
    const off = await createSimulado(me, cfg({ aiHints: false }))
    const offItems = await itemsOf(off.id)
    await expect(hintForItem(me, off.id, offItems.obj.id)).rejects.toMatchObject({ status: 403 })
  })
})

describe.runIf(LIVE)('IA no simulado — OpenRouter real (AI_LIVE=1)', () => {
  it('dica marca used_hint, explicação respeita o gabarito, correção por IA dá nota e pontos de acerto', { timeout: 180_000 }, async () => {
    const { id } = await createSimulado(me, cfg())
    const { obj, disc } = await itemsOf(id)

    const h = await hintForItem(me, id, obj.id)
    expect(h.hint.length).toBeGreaterThan(10)
    expect((await getSimulado(me, id)).answers[obj.id].usedHint).toBe(true)

    await saveAnswer(me, id, obj.id, { choiceId: obj.alternatives![0].id })
    await revealItem(me, id, obj.id)
    const e = await explainItem(me, id, obj.id)
    expect(e.summary.length).toBeGreaterThan(20)
    const right = obj.alternatives!.find((a) => a.text.startsWith('Repetir'))!.id
    expect(e.perAlternative.find((p) => p.verdict === 'correta')?.id ?? right).toBe(right)

    await saveAnswer(me, id, disc.id, { text: 'Multiparidade, principalmente por partos vaginais, e a idade avançada com queda do estrogênio.' })
    await revealItem(me, id, disc.id)
    const g = await aiGradeItem(me, id, disc.id)
    expect(g.answer).toMatchObject({ gradedBy: 'ia' })
    expect(g.answer.score).toBeGreaterThanOrEqual(0.5)
    expect(g.matched).toHaveLength(2)
    expect(g.feedback.length).toBeGreaterThan(0)
    const s = await finishSimulado(me, id)
    expect(s.pending).toBe(0)
  })

  it('distratores avulsos preservam a correta escrita pelo autor (T037)', { timeout: 120_000 }, async () => {
    const out = await generateDistractors(
      [
        { id: 'a', stem: 'Qual o principal fator de risco para prolapso genital?', expectedAnswer: 'Multiparidade com partos vaginais.' },
        { id: 'b', stem: 'Qual o exame inicial no rastreio do câncer de colo do útero?', expectedAnswer: 'Citologia oncótica (Papanicolau).', correct: 'Papanicolau' },
      ],
      me,
    )
    expect(out.map((o) => o.id).sort()).toEqual(['a', 'b'])
    expect(out.every((o) => o.incorrect.length === 4)).toBe(true)
    expect(out.find((o) => o.id === 'b')!.correct).toBe('Papanicolau')
  })
})
