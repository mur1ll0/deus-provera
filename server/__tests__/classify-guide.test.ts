import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentGuide } from '../../shared/document-guide'

/**
 * Nó `classify` com o GUIA DO DOCUMENTO (spec 002 FR-018a): a legenda de temas classifica sem IA, o resto vai
 * à IA com o guia como pista (dentro do wrapUntrusted), e sem IA as questões ficam na disciplina indicada.
 * Cota diária esgotada pausa o job (FR-021).
 */

const h = vi.hoisted(() => ({ calls: [] as { system: string; prompt: string }[], mode: 'ok' as 'ok' | 'down' | 'quota' }))

vi.mock('../ai/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ai/client')>()
  return {
    ...real,
    callStructured: vi.fn(async (call: { system: string; prompt: string }) => {
      h.calls.push(call)
      if (h.mode === 'down') throw new real.AiUnavailableError('classify', [])
      if (h.mode === 'quota') throw new real.AiQuotaExhaustedError('classify', [])
      const ids = [...call.prompt.matchAll(/^id: (\S+)/gm)].map((m) => m[1])
      return { value: { grupos: [{ area: 'Medicina', disciplina: 'Ginecologia', assunto: 'Outros temas', descricao: 'x', questoes: ids.map((id) => ({ id, resumo: `r ${id}` })) }] }, model: 'm:free', attempts: [] }
    }),
  }
})

const { importGraph, classifyByGuide, GUIDE_FALLBACK_TOPIC } = await import('../ai/pipelines/import-graph')
const { AiQuotaExhaustedError } = await import('../ai/client')

const TAXONOMY = 'Medicina > Ginecologia\nMedicina > Obstetrícia'
const guide = (topics: DocumentGuide['topics']): DocumentGuide => ({ title: 'Casos - Ginecologia', titleLines: ['Casos - Ginecologia'], explicit: {}, topics, hasFrontMatter: true, page: 2 })
const LEGEND = guide([
  { numbers: [1, 2], assunto: 'Prolapso genital', source: '01-02' },
  { numbers: [3, 5], assunto: 'Vaginites', source: '03,05' },
  { numbers: [4], assunto: 'Anticoncepção', source: '04' },
])

/** Estado já estruturado: questões "QUESTÃO 1…n" (+ um bloco "1)" que é parte da questão 4), cursor em classify. */
function structured(labels: string[], g: DocumentGuide | undefined) {
  const blocks = labels.map((label, i) => ({ id: `b${i + 1}`, text: label, seg: { sourceLabel: label, stem: `Caso ${label}`, items: [{ prompt: 'Conduta?' }], page: 1 }, risk: 'baixo' as const }))
  const drafts = Object.fromEntries(
    blocks.map((b) => [
      b.id,
      { id: b.id, blockId: b.id, area: 'Sem área', disciplina: 'Sem disciplina', rotulo: b.seg.sourceLabel, enunciado: b.seg.stem, perguntas: [{ rotulo: null, texto: 'Conduta?', tipo: 'discursiva' as const, resposta_esperada: 'x', pontos_chave: [], alternativas: null }], flags: [] },
    ]),
  )
  const s = importGraph.initial({ nonce: 'n0nce', options: { generateDistractors: false }, rawPages: [], blocks, guide: g, pendingBatches: [], pendingDistractors: [], drafts, cards: [], warnings: [], aiLog: [], guardRisk: 'baixo' } as never)
  return { ...s, cursor: 'classify' }
}

const noAi = { userId: 'u', taxonomy: TAXONOMY, reserveAiRequest: async () => void h.calls.push({ system: 'reserve', prompt: '' }) }

beforeEach(() => {
  h.calls = []
  h.mode = 'ok'
})

describe('classificação pelo guia do documento', () => {
  it('legenda + disciplina reconhecida: cards por tema, na ordem do documento, SEM chamar a IA', async () => {
    const s = await importGraph.step(structured(['QUESTÃO 1', 'QUESTÃO 2', 'QUESTÃO 3', 'QUESTÃO 4', '1)', 'QUESTÃO 5'], LEGEND), noAi)
    expect(h.calls).toEqual([])
    expect(s.cards.map((c) => [`${c.area} › ${c.disciplina} › ${c.assunto}`, c.questionIds])).toEqual([
      ['Medicina › Ginecologia › Prolapso genital', ['b1', 'b2']],
      ['Medicina › Ginecologia › Vaginites', ['b3', 'b6']],
      ['Medicina › Ginecologia › Anticoncepção', ['b4', 'b5']], // "1)" logo após a QUESTÃO 4 é parte dela
    ])
    expect(s.cards[0].descricao).toContain('01-02')
    expect(s.pendingClassify).toEqual([])
    expect(s.cursor).toBe('validate')
    expect(s.warnings.at(-1)).toBe('6 de 6 questões classificadas pela lista de temas do próprio documento.')
  })

  it('o que a legenda não cobre vai à IA com o guia como pista (dentro dos dados, não no system)', async () => {
    let s = await importGraph.step(structured(['QUESTÃO 1', 'QUESTÃO 9'], LEGEND), noAi)
    expect(s.pendingClassify).toEqual([['b2']])
    s = await importGraph.step(s, noAi)
    const ai = h.calls.find((c) => c.system !== 'reserve')!
    expect(ai.prompt).toContain('GUIA DO DOCUMENTO')
    expect(ai.prompt).toContain('Disciplina indicada: Medicina › Ginecologia')
    expect(ai.prompt).toContain('01-02 = Prolapso genital')
    expect(ai.system).not.toContain('Temas por questão') // o guia é dado do usuário: nunca vai no system
    expect(ai.system).toContain('GUIA DO DOCUMENTO')
    expect(s.cards.map((c) => c.assunto)).toEqual(['Prolapso genital', 'Outros temas'])
  })

  it('sem IA: questões fora da legenda ficam na disciplina indicada pelo documento ("Geral"), não em "Sem área"', async () => {
    h.mode = 'down'
    let s = await importGraph.step(structured(['QUESTÃO 1', 'QUESTÃO 9'], LEGEND), noAi)
    s = await importGraph.step(s, noAi)
    expect(s.cards.map((c) => `${c.area} › ${c.disciplina} › ${c.assunto}`)).toEqual(['Medicina › Ginecologia › Prolapso genital', `Medicina › Ginecologia › ${GUIDE_FALLBACK_TOPIC}`])
  })

  it('sem guia e sem IA: continua em "Revisar categoria" (comportamento anterior)', async () => {
    h.mode = 'down'
    const s = await importGraph.step(structured(['QUESTÃO 1'], undefined), noAi)
    expect(s.cards.map((c) => [c.area, c.assunto])).toEqual([['Sem área', 'Revisar categoria']])
  })

  it('disciplina fora da taxonomia: nada é classificado sem IA (área desconhecida)', () => {
    const r = classifyByGuide(structured(['QUESTÃO 1'], LEGEND).drafts, structured(['QUESTÃO 1'], LEGEND).blocks, LEGEND, 'Direito > Direito Civil')
    expect(r).toEqual({ grupos: [], rest: ['b1'] })
  })

  it('cota diária esgotada na classificação: o passo PARA (a rota pausa o job e sugere o agente próprio)', async () => {
    h.mode = 'quota'
    await expect(importGraph.step(structured(['QUESTÃO 9'], LEGEND), noAi)).rejects.toBeInstanceOf(AiQuotaExhaustedError)
  })
})
