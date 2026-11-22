import { describe, expect, it } from 'vitest'
import { checkWrittenAnswers } from '../ai/quality'
import { writtenAnswersSchema } from '../ai/schemas'

const item = (id: string, resposta: string) => ({ id, resposta_esperada: resposta, pontos_chave: ['Ponto 1', 'Ponto 2', 'Ponto 3'] })

describe('objetiva → discursiva (FR-R8)', () => {
  it('aceita resposta escrita que não depende das alternativas', () => {
    expect(checkWrittenAnswers({ itens: [item('a', 'Hipertensão estágio 1; confirmar com MAPA ou MRPA.')] }, ['a'])).toBeNull()
    // "alternativa e" (conjunção) não é citação de letra
    expect(checkWrittenAnswers({ itens: [item('a', 'A conduta alternativa e a principal são a cirurgia.')] }, ['a'])).toBeNull()
  })

  it('recusa resposta que cita a letra da alternativa', () => {
    for (const r of ['A resposta é a alternativa C, pois…', 'Letra (B): hímen.', 'Opção E, porque o colo…']) {
      expect(checkWrittenAnswers({ itens: [item('a', r)] }, ['a'])).toMatch(/não cite letras/)
    }
  })

  it('exige uma resposta para cada pergunta enviada', () => {
    expect(checkWrittenAnswers({ itens: [item('a', 'Resposta completa aqui.')] }, ['a', 'b'])).toMatch(/b/)
  })

  it('schema exige de 3 a 6 pontos de acerto', () => {
    expect(writtenAnswersSchema.safeParse({ itens: [{ ...item('a', 'Resposta completa.'), pontos_chave: ['só um'] }] }).success).toBe(false)
  })
})
