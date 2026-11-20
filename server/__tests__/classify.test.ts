import { describe, expect, it } from 'vitest'
import { cleanLabel, mergeClassification, planClassifyBatches, UNCLASSIFIED_TOPIC, type DraftItem } from '../ai/pipelines/import-graph'

const draft = (id: string): DraftItem => ({
  id,
  blockId: id,
  area: 'Sem área',
  disciplina: 'Sem disciplina',
  rotulo: null,
  enunciado: `Enunciado ${id}`,
  perguntas: [{ rotulo: null, texto: 'Qual a conduta?', tipo: 'discursiva', resposta_esperada: 'x', pontos_chave: [], alternativas: null }],
  pagina: 1,
  flags: [],
})
const drafts = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`b${i}`, draft(`b${i}`)]))
const grupo = (assunto: string, ids: string[], area = 'Medicina', disciplina = 'Ginecologia') => ({
  area,
  disciplina,
  assunto,
  descricao: `Sobre ${assunto}`,
  questoes: ids.map((id) => ({ id, resumo: `resumo ${id}` })),
})

describe('classificação em lotes (spec 002 › T033)', () => {
  it('85 questões viram lotes de 20, na ordem do documento', () => {
    const batches = planClassifyBatches(drafts(85))
    expect(batches.map((b) => b.length)).toEqual([20, 20, 20, 20, 5])
    expect(batches[0][0]).toBe('b0')
    expect(batches[4].at(-1)).toBe('b84')
  })

  it('mesmo assunto em lotes diferentes (acento/caixa diferentes) vira um card só', () => {
    const d = drafts(4)
    let r = mergeClassification([], d, ['b0', 'b1'], [grupo('Lesões do colo do útero', ['b0', 'b1'])])
    r = mergeClassification(r.cards, r.drafts, ['b2', 'b3'], [grupo('lesoes do colo do utero', ['b2']), grupo('Prolapso genital', ['b3'])])
    expect(r.cards.map((c) => [c.assunto, c.questionIds])).toEqual([
      ['Lesões do colo do útero', ['b0', 'b1', 'b2']],
      ['Prolapso genital', ['b3']],
    ])
    expect(r.drafts.b2).toMatchObject({ area: 'Medicina', disciplina: 'Ginecologia', assunto: 'Lesões do colo do útero', resumo: 'resumo b2' })
  })

  it('ids omitidos vão para "Revisar categoria" (sempre o último card); inventados/repetidos/de outro lote são ignorados', () => {
    const d = drafts(6)
    let r = mergeClassification([], d, ['b0', 'b1', 'b2'], [grupo('A', ['b0', 'b0', 'x9', 'b5'])])
    expect(r.cards.map((c) => [c.assunto, c.questionIds])).toEqual([
      ['A', ['b0']],
      [UNCLASSIFIED_TOPIC, ['b1', 'b2']],
    ])
    r = mergeClassification(r.cards, r.drafts, ['b3', 'b4', 'b5'], [grupo('B', ['b3', 'b5'])])
    expect(r.cards.map((c) => [c.assunto, c.questionIds])).toEqual([
      ['A', ['b0']],
      ['B', ['b3', 'b5']],
      [UNCLASSIFIED_TOPIC, ['b1', 'b2', 'b4']],
    ])
  })

  it('IA indisponível num lote: só as questões desse lote vão para revisão', () => {
    const d = drafts(4)
    let r = mergeClassification([], d, ['b0', 'b1'], [grupo('A', ['b0', 'b1'])])
    r = mergeClassification(r.cards, r.drafts, ['b2', 'b3'], [], 'Classificação automática indisponível — organize manualmente.')
    expect(r.cards.at(-1)).toMatchObject({ assunto: UNCLASSIFIED_TOPIC, questionIds: ['b2', 'b3'], descricao: expect.stringMatching(/indisponível/) })
  })

  it('rótulo com lixo de outro alfabeto é limpo', () => {
    expect(cleanLabel('Infecção por HPV e lesões do colo: rastrear,従')).toBe('Infecção por HPV e lesões do colo: rastrear')
    expect(cleanLabel('  Ginecologia  ')).toBe('Ginecologia')
    expect(cleanLabel('Área › Disciplina — ')).toBe('Área › Disciplina')
  })
})
