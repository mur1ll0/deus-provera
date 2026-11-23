import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Spec 002 US6 — questões e gabarito em PDFs separados, no grafo de importação (sem rede e sem banco):
 * nó `segment` com `docs` (liga pelo número, sem IA), nó `link` (IA só escolhe pares de ids; ids inventados
 * ou repetidos são ignorados; sem IA a questão segue marcada) e fallback determinístico com a resposta ligada.
 */

const h = vi.hoisted(() => ({ calls: [] as { task: string; prompt: string }[], pairs: [] as { questao_id: string; resposta_id: string }[], fail: false }))

vi.mock('../ai/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ai/client')>()
  return {
    ...real,
    callStructured: vi.fn(async (call: { task: string; prompt: string }) => {
      h.calls.push({ task: call.task, prompt: call.prompt })
      if (h.fail) throw new real.AiUnavailableError(call.task as never, [])
      if (call.task === 'link') return { value: { pares: h.pairs }, model: 'm:free', attempts: [] }
      throw new real.AiUnavailableError(call.task as never, []) // structure/classify: fallback determinístico
    }),
  }
})

const { importGraph, blockText } = await import('../ai/pipelines/import-graph')

const QUESTIONS = [
  { page: 1, text: 'Caderno — Questões\nEstação 1.1 — Título\nFonte: Nova\nMulher de 40 anos com dor pélvica há meses.\na) Qual o diagnóstico?\nb) Qual exame pedir?' },
  { page: 2, text: 'Estação 1.2 — Outro título\nHomem de 50 anos com tosse crônica e dispneia.\nQual a conduta inicial?' },
  { page: 3, text: 'Estação 1.3 — Sem par\nCriança de 4 anos com chiado recorrente há meses.\nCite dois diferenciais?' },
]
const ANSWERS = [
  { page: 4, text: 'Caderno — Gabarito\nEstação 1.1 — Título\na) Endometriose.\nb) Ultrassonografia transvaginal.\nEstação 1.2 — Outro título\nEspirometria e cessar o tabagismo.' },
  { page: 5, text: 'Estação 7.7 — Resposta sem número em comum\nAsma e corpo estranho.' },
]

function initial(withDocs = true) {
  const s = importGraph.initial({
    nonce: 'n0nce',
    options: { generateDistractors: false },
    rawPages: withDocs ? [...QUESTIONS, ...ANSWERS] : QUESTIONS,
    ...(withDocs
      ? {
          docs: [
            { name: 'q.pdf', role: 'questoes', firstPage: 1, lastPage: 3 },
            { name: 'g.pdf', role: 'respostas', firstPage: 4, lastPage: 5 },
          ],
        }
      : {}),
    images: {},
    blocks: [],
    pendingBatches: [],
    pendingDistractors: [],
    drafts: {},
    cards: [],
    warnings: [],
    aiLog: [],
    guardRisk: 'baixo',
  } as never)
  return { ...s, cursor: 'segment' }
}

const ctx = { userId: 'u1', taxonomy: 'Medicina > Ginecologia', reserveAiRequest: async () => {} }

beforeEach(() => {
  h.calls = []
  h.pairs = []
  h.fail = false
})

describe('segment com questões e gabarito separados', () => {
  it('liga pelo número sem IA; o que sobrou vai para o nó link', async () => {
    const s = await importGraph.step(initial(), ctx)
    expect(s.blocks.map((b) => b.seg.sourceLabel)).toEqual(['Estação 1.1', 'Estação 1.2', 'Estação 1.3'])
    expect(s.blocks[0].seg.items.map((i) => i.answer)).toEqual(['Endometriose.', 'Ultrassonografia transvaginal.'])
    expect(s.blocks[0].text).toContain('Resposta (gabarito): Endometriose.')
    expect(s.link).toMatchObject({ entries: 3, questions: 3, linkedQuestions: 2 })
    expect(s.pendingLink?.blockIds).toEqual(['b3'])
    expect(s.pendingLink?.entries.map((e) => e.label)).toEqual(['Estação 7.7'])
    expect(s.warnings.some((w) => /2 de 3 questões ligadas/.test(w))).toBe(true)
    expect(s.cursor).toBe('link')
    expect(h.calls).toEqual([])
  })

  it('link: a IA escolhe o par; o texto da resposta é o do gabarito', async () => {
    const seg = await importGraph.step(initial(), ctx)
    h.pairs = [
      { questao_id: 'b3', resposta_id: 'r3' },
      { questao_id: 'b9', resposta_id: 'r3' }, // id inventado: ignorado
    ]
    const s = await importGraph.step(seg, ctx)
    expect(h.calls.map((c) => c.task)).toEqual(['link'])
    expect(h.calls[0].prompt).toContain('<dados_n0nce>')
    expect(s.blocks[2].seg.items[0].answer).toBe('Asma e corpo estranho.')
    expect(s.blocks[2].seg.flags).toEqual(['Resposta ligada pela IA (sem número em comum) — confira'])
    expect(s.blocks[2].text).toBe(blockText(s.blocks[2].seg))
    expect(s.link?.linkedQuestions).toBe(3)
    expect(s.link?.orphanEntries).toEqual([])
    expect(s.pendingLink).toBeUndefined()
    expect(s.cursor).toBe('structure')
  })

  it('link sem IA: segue para a estruturação com a questão marcada (nada se perde)', async () => {
    const seg = await importGraph.step(initial(), ctx)
    h.fail = true
    const s = await importGraph.step(seg, ctx)
    expect(s.cursor).toBe('structure')
    expect(s.blocks[2].seg.flags).toEqual(['Resposta não encontrada no gabarito — revise'])
    expect(s.warnings.at(-1)).toMatch(/indisponível/)
  })

  it('fallback determinístico da estruturação mantém a resposta do gabarito e os avisos', async () => {
    let s = await importGraph.step(initial(), ctx)
    h.fail = true
    s = await importGraph.step(s, ctx) // link (sem IA)
    s = await importGraph.step(s, ctx) // structure (fallback)
    expect(s.drafts.b1.perguntas.map((p) => p.resposta_esperada)).toEqual(['Endometriose.', 'Ultrassonografia transvaginal.'])
    expect(s.drafts.b2.perguntas[0].resposta_esperada).toBe('Espirometria e cessar o tabagismo.')
    expect(s.drafts.b3.flags).toContain('Resposta não encontrada no gabarito — revise')
    // o título do cabeçalho (às vezes a própria resposta) não entra no enunciado
    expect(s.drafts.b1.enunciado).not.toContain('Título')
  })

  it('sem docs (PDF único, sem gabarito) continua como antes: sem ligação, sem nó link', async () => {
    const s = await importGraph.step(initial(false), ctx)
    expect(s.link).toBeUndefined()
    expect(s.blocks).toHaveLength(3)
    expect(s.cursor).toBe('structure')
  })

  it('sem docs, mas com o gabarito no fim do mesmo PDF: liga igual', async () => {
    const base = initial(false)
    const s = await importGraph.step({ ...base, rawPages: [...QUESTIONS, ...ANSWERS] }, ctx)
    expect(s.link?.linkedQuestions).toBe(2)
    expect(s.blocks[1].seg.items[0].answer).toBe('Espirometria e cessar o tabagismo.')
    expect(s.warnings.some((w) => /Seção de respostas encontrada na pág\. 4/.test(w))).toBe(true)
  })
})
