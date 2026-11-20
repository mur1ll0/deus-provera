import { HTTPException } from 'hono/http-exception'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Nó `structure` com lotes em paralelo (até STRUCTURE_PARALLEL por passo), sem rede:
 * concorrência real, ordem do documento preservada, fallback por lote e cota esgotada no meio do passo.
 */

const h = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0, calls: 0, failBatchWith: null as string | null, quotaBatch: null as string | null, popq: false }))
const POPQ_LINE = 'POP-Q — Aa +1; Ba +3; C -6; HG 4; CP 3; CVT 8; Ap -3; Bp -3; D -8'

vi.mock('../ai/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ai/client')>()
  return {
    ...real,
    callStructured: vi.fn(async (call: { task: string; prompt: string; onAttempt?: (l: unknown) => void }) => {
      const ids = [...call.prompt.matchAll(/bloco_id: (b\d+)/g)].map((m) => m[1])
      h.calls++
      h.inFlight++
      h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
      // o 1º lote demora mais: se fosse sequencial, a ordem de término inverteria a ordem do documento
      await new Promise((r) => setTimeout(r, ids.includes('b1') ? 30 : 5))
      h.inFlight--
      if (h.failBatchWith && ids.includes(h.failBatchWith)) throw new real.AiUnavailableError('structure', [])
      if (h.quotaBatch && ids.includes(h.quotaBatch)) throw new real.AiQuotaExhaustedError('structure', [])
      call.onAttempt?.({ task: 'structure', model: 'm:free', ok: true, latencyMs: 1 })
      return {
        value: {
          questoes: ids.map((id) => ({
            bloco_id: id,
            rotulo: null,
            enunciado: h.popq ? `Enunciado ${id}. ${POPQ_LINE}` : `Enunciado ${id}`,
            perguntas: [{ rotulo: null, texto: `Pergunta ${id}`, tipo: 'discursiva', resposta_esperada: h.popq ? `Resposta ${id} [Imagem p. 2: Exame | Valor / Hb | 9,8]` : `Resposta ${id}`, pontos_chave: [], alternativas: null }],
            dificuldade: 'media',
            tem_imagem: false,
          })),
          descartados: [],
          alertas: [],
        },
        model: 'm:free',
        attempts: [],
      }
    }),
  }
})

const { importGraph, STRUCTURE_PARALLEL } = await import('../ai/pipelines/import-graph')

/** Estado já segmentado: `n` blocos, 1 por lote (cursor no nó structure). */
function segmented(n: number) {
  const blocks = Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    text: `QUESTÃO ${i + 1}. Enunciado b${i + 1}\nPergunta b${i + 1} Resposta b${i + 1}`,
    seg: { sourceLabel: `QUESTÃO ${i + 1}`, stem: `Enunciado b${i + 1}`, items: [{ prompt: `Pergunta b${i + 1}`, answer: `Resposta b${i + 1}` }], page: 1 },
    risk: 'baixo' as const,
  }))
  const s = importGraph.initial({
    nonce: 'n0nce',
    options: { generateDistractors: false },
    rawPages: [],
    blocks,
    pendingBatches: blocks.map((b) => [b.id]),
    pendingDistractors: [],
    drafts: {},
    cards: [],
    warnings: [],
    aiLog: [],
    guardRisk: 'baixo',
  } as never)
  return { ...s, cursor: 'structure' }
}

const ctx = (reserve: () => Promise<void> = async () => {}) => ({ userId: 'u1', taxonomy: '', reserveAiRequest: reserve })

beforeEach(() => {
  h.inFlight = h.maxInFlight = h.calls = 0
  h.failBatchWith = null
  h.quotaBatch = null
  h.popq = false
})

describe('structure em paralelo', () => {
  it(`roda até ${STRUCTURE_PARALLEL} lotes ao mesmo tempo e mantém a ordem do documento`, async () => {
    const s = await importGraph.step(segmented(5), ctx())
    expect(h.maxInFlight).toBe(STRUCTURE_PARALLEL)
    expect(Object.keys(s.drafts)).toEqual(['b1', 'b2', 'b3'])
    expect(s.pendingBatches).toEqual([['b4'], ['b5']])
    expect(s.cursor).toBe('structure')
    expect(s.aiLog).toHaveLength(3)

    const s2 = await importGraph.step(s, ctx())
    expect(Object.keys(s2.drafts)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
    expect(s2.pendingBatches).toEqual([])
    expect(s2.cursor).toBe('classify')
  })

  it('IA indisponível num lote: só ele cai no fallback, os outros seguem pela IA', async () => {
    h.failBatchWith = 'b2'
    const s = await importGraph.step(segmented(3), ctx())
    expect(Object.keys(s.drafts)).toEqual(['b1', 'b2', 'b3'])
    expect(s.drafts.b2.flags).toContain('Processado sem IA — revise')
    expect(s.drafts.b1.enunciado).toBe('Enunciado b1')
    expect(s.drafts.b3.enunciado).toBe('Enunciado b3')
    expect(s.warnings).toContain('IA indisponível para um lote; itens marcados para revisão.')
  })

  it('cota esgotada no meio do passo: processa só os lotes reservados e mantém o resto na fila', async () => {
    let left = 2
    const reserve = async () => {
      if (left-- <= 0) throw new HTTPException(429, { message: 'Cota diária de IA do sistema atingida.' })
    }
    const s = await importGraph.step(segmented(4), ctx(reserve))
    expect(h.calls).toBe(2)
    expect(Object.keys(s.drafts)).toEqual(['b1', 'b2'])
    expect(s.pendingBatches).toEqual([['b3'], ['b4']])
  })

  it('rascunho da IA: linha POP-Q vira a grade e tabela da visão vira tabela Markdown (shared/tables.ts)', async () => {
    h.popq = true
    const s = await importGraph.step(segmented(1), ctx())
    expect(s.drafts.b1.enunciado).toBe(
      'Enunciado b1.\nPOP-Q:\n| **Aa** | **Ba** | **C** |\n| +1 | +3 | -6 |\n| **HG** | **CP** | **CVT** |\n| 4 | 3 | 8 |\n| **Ap** | **Bp** | **D** |\n| -3 | -3 | -8 |',
    )
    expect(s.drafts.b1.perguntas[0].resposta_esperada).toBe('Resposta b1\n[Imagem p. 2: tabela]\n| Exame | Valor |\n| Hb | 9,8 |')
  })

  it('cota esgotada já no 1º lote: o passo falha com 429 (a rota salva o checkpoint)', async () => {
    const reserve = async () => {
      throw new HTTPException(429, { message: 'Cota diária de IA do sistema atingida.' })
    }
    await expect(importGraph.step(segmented(2), ctx(reserve))).rejects.toMatchObject({ status: 429 })
    expect(h.calls).toBe(0)
  })

  it('cota diária do OpenRouter esgotada: o passo PARA (sem rascunho "sem IA" em silêncio) para a rota pausar o job', async () => {
    h.quotaBatch = 'b2'
    const { AiQuotaExhaustedError } = await import('../ai/client')
    await expect(importGraph.step(segmented(3), ctx())).rejects.toBeInstanceOf(AiQuotaExhaustedError)
  })
})
