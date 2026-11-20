import { describe, expect, it } from 'vitest'
import { brtDay, computeStreak, lastDays } from '../stats'

describe('brtDay / lastDays (fuso de Brasília)', () => {
  it('antes das 3h UTC ainda é o dia anterior em Brasília', () => {
    expect(brtDay(new Date('2026-11-20T02:59:00Z'))).toBe('2026-11-19')
    expect(brtDay(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-20')
  })
  it('lista n dias terminando hoje, atravessando o mês', () => {
    expect(lastDays(3, new Date('2026-12-01T12:00:00Z'))).toEqual(['2026-11-29', '2026-11-30', '2026-12-01'])
  })
})

describe('computeStreak', () => {
  const today = new Date('2026-11-20T15:00:00Z')
  it('sem atividade → 0', () => expect(computeStreak([], today)).toEqual({ current: 0, best: 0 }))
  it('conta até hoje', () => expect(computeStreak(['2026-11-18', '2026-11-19', '2026-11-20'], today)).toEqual({ current: 3, best: 3 }))
  it('hoje ainda sem atividade: a sequência vale até ontem', () => expect(computeStreak(['2026-11-18', '2026-11-19'], today).current).toBe(2))
  it('quebra se faltou ontem e hoje; o recorde fica', () =>
    expect(computeStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-17'], today)).toEqual({ current: 0, best: 4 }))
})
