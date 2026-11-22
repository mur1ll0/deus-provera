import { describe, expect, it } from 'vitest'
import { missingFormats, needsDiscursive, needsMultipleChoice } from '../completeness'

const alts = [
  { id: 'a1', text: 'Certa', correct: true, source: 'usuario' as const },
  { id: 'a2', text: 'Errada', correct: false, source: 'usuario' as const },
]

describe('formatos que faltam (FR-R8)', () => {
  it('discursiva sem alternativas precisa de múltipla escolha', () => {
    expect(needsMultipleChoice({ id: 'i', expectedAnswer: 'Resposta', alternatives: [] })).toBe(true)
    expect(needsDiscursive({ id: 'i', expectedAnswer: 'Resposta', alternatives: [] })).toBe(false)
  })

  it('objetiva sem resposta escrita precisa de discursiva', () => {
    expect(needsDiscursive({ id: 'i', expectedAnswer: '  ', alternatives: alts })).toBe(true)
    expect(needsMultipleChoice({ id: 'i', alternatives: alts })).toBe(false)
  })

  it('alternativas inválidas (sem correta) não contam como múltipla escolha', () => {
    const semCorreta = alts.map((a) => ({ ...a, correct: false }))
    expect(needsMultipleChoice({ id: 'i', expectedAnswer: 'R', alternatives: semCorreta })).toBe(true)
    expect(needsDiscursive({ id: 'i', alternatives: semCorreta })).toBe(false)
  })

  it('pergunta completa ou sem nenhuma resposta não entra', () => {
    expect(needsMultipleChoice({ id: 'i', expectedAnswer: 'R', alternatives: alts })).toBe(false)
    expect(needsDiscursive({ id: 'i', expectedAnswer: 'R', alternatives: alts })).toBe(false)
    expect(needsMultipleChoice({ id: 'i' })).toBe(false)
    expect(needsDiscursive({ id: 'i' })).toBe(false)
  })

  it('conta questões (não perguntas): basta uma pergunta faltando', () => {
    const q1 = { id: 'q1', items: [{ id: 'a', expectedAnswer: 'R', alternatives: alts }, { id: 'b', expectedAnswer: 'R' }] }
    const q2 = { id: 'q2', items: [{ id: 'c', alternatives: alts }] }
    const q3 = { id: 'q3', items: [{ id: 'd', expectedAnswer: 'R', alternatives: alts }] }
    const m = missingFormats([q1, q2, q3])
    expect(m.multipla.map((q) => q.id)).toEqual(['q1'])
    expect(m.discursiva.map((q) => q.id)).toEqual(['q2'])
  })
})
