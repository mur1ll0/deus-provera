import { describe, expect, it } from 'vitest'
import { brtDay, computeStreak, lastDays, pickWeakest } from '../stats'

describe('pickWeakest (ponto mais fraco do painel)', () => {
  // Caso real que motivou a regra: só "Câncer de mama" tinha 5 respostas e era apontado com 60%.
  const topics = [
    { topic: 'Câncer de mama', accuracy: 0.6, answered: 5 },
    { topic: 'HPV, NIC e câncer de colo', accuracy: 0.25, answered: 4 },
    { topic: 'Sangramento uterino anormal', accuracy: 1 / 3, answered: 3 },
    { topic: 'Climatério', accuracy: 0, answered: 2 },
    { topic: 'Vaginites', accuracy: 0, answered: 2 },
    { topic: 'Uma resposta só', accuracy: 0, answered: 1 },
  ]
  it('aponta o menor acerto, não o assunto mais respondido', () => {
    expect(pickWeakest(topics)?.topic).toBe('Climatério')
  })
  it('ignora assuntos com uma resposta só e desempata pelo mais respondido', () => {
    expect(pickWeakest([{ topic: 'a', accuracy: 0, answered: 1 }, { topic: 'b', accuracy: 0.5, answered: 2 }])?.topic).toBe('b')
    expect(pickWeakest([{ topic: 'a', accuracy: 0, answered: 2 }, { topic: 'b', accuracy: 0, answered: 3 }])?.topic).toBe('b')
  })
  it('sem respostas suficientes → null', () => {
    expect(pickWeakest([{ accuracy: 0, answered: 1 }])).toBeNull()
  })
})

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
