import { describe, expect, it } from 'vitest'
import { autoTimeLimitMin, isEligible, presentAs, rankingPeriodStart } from '../simulado'

describe('autoTimeLimitMin', () => {
  it('soma 2 min/objetiva e 6 min/discursiva', () => {
    expect(autoTimeLimitMin(['objetiva', 'objetiva', 'discursiva'])).toBe(10)
  })
  it('respeita o mínimo de 5 min', () => {
    expect(autoTimeLimitMin(['objetiva'])).toBe(5)
  })
})

describe('presentAs / isEligible (por pergunta)', () => {
  const alts = [
    { id: 'a', text: 'certa', correct: true, source: 'ia' as const },
    { id: 'b', text: 'errada', correct: false, source: 'ia' as const },
  ]
  const disc = { type: 'discursiva' as const, expectedAnswer: 'resposta', alternatives: alts }
  it('discursiva com alternativas: múltipla escolha só no formato multipla', () => {
    expect(presentAs(disc, 'multipla')).toBe('objetiva')
    expect(presentAs(disc, 'original')).toBe('discursiva')
    expect(presentAs(disc, 'discursiva')).toBe('discursiva')
  })
  it('alternativas inválidas (duas corretas) não viram múltipla escolha', () => {
    expect(presentAs({ ...disc, alternatives: alts.map((a) => ({ ...a, correct: true })) }, 'multipla')).toBe('discursiva')
  })
  it('objetiva sem resposta escrita continua objetiva mesmo no formato discursiva', () => {
    expect(presentAs({ type: 'objetiva', alternatives: alts }, 'discursiva')).toBe('objetiva')
  })
  it('elegibilidade: multipla exige alternativas em TODAS as perguntas', () => {
    expect(isEligible({ items: [disc as never, { ...disc, alternatives: [] } as never] }, 'multipla')).toBe(false)
    expect(isEligible({ items: [disc as never, disc as never] }, 'multipla')).toBe(true)
    expect(isEligible({ items: [{ type: 'objetiva', alternatives: alts } as never] }, 'discursiva')).toBe(false)
  })
})

describe('rankingPeriodStart (fuso de Brasília)', () => {
  it('segunda 01:00 BRT ainda é a mesma semana (bug clássico de usar o dia UTC)', () => {
    // 2026-11-23 é segunda. 01:00 BRT = 04:00 UTC.
    const start = rankingPeriodStart('semana', new Date('2026-11-23T04:00:00Z'))
    expect(start?.toISOString()).toBe('2026-11-23T03:00:00.000Z')
  })
  it('domingo 23:30 BRT pertence à semana iniciada na segunda anterior', () => {
    // 2026-11-22 23:30 BRT = 2026-11-23 02:30 UTC (já é segunda em UTC!)
    const start = rankingPeriodStart('semana', new Date('2026-11-23T02:30:00Z'))
    expect(start?.toISOString()).toBe('2026-11-16T03:00:00.000Z')
  })
  it('mês começa no dia 1 às 00:00 BRT', () => {
    expect(rankingPeriodStart('mes', new Date('2026-12-01T02:00:00Z'))?.toISOString()).toBe('2026-11-01T03:00:00.000Z')
  })
  it('geral não tem início', () => {
    expect(rankingPeriodStart('geral')).toBeNull()
  })
})
