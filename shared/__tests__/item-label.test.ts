import { describe, expect, it } from 'vitest'
import { itemMarker } from '../item-label'

describe('itemMarker (círculo da pergunta no simulado)', () => {
  it('mantém rótulos curtos', () => {
    expect(itemMarker('a', 0)).toBe('a')
    expect(itemMarker('12', 0)).toBe('12')
    expect(itemMarker('b)', 1)).toBe('b')
    expect(itemMarker('(c)', 2)).toBe('c')
  })

  it('usa o identificador final de rótulos longos', () => {
    expect(itemMarker('Parte 2', 1)).toBe('2')
    expect(itemMarker('Paciente 1', 0)).toBe('1')
    expect(itemMarker('Parte II', 1)).toBe('II')
    expect(itemMarker('Questão 3-a', 0)).toBe('a')
  })

  it('cai na posição quando não há rótulo usável', () => {
    expect(itemMarker(undefined, 0)).toBe('1')
    expect(itemMarker('', 2)).toBe('3')
    expect(itemMarker('Anamnese', 3)).toBe('4')
  })
})
