import { describe, expect, it } from 'vitest'
import { contentHash, normalizeForHash } from '../content-hash'
import { questionInput } from '../schemas/question'

const AREA = '4b1f5f0e-6a3c-4d1e-9f7a-2b8c9d0e1f2a'

const base = {
  areaId: AREA,
  discipline: 'Ginecologia',
  topic: 'Prolapso genital',
  stem: 'Paciente de 62 anos com sensação de "bola na vagina".',
  items: [{ type: 'discursiva', prompt: '', expectedAnswer: 'Prolapso uterino', keyPoints: ['prolapso', ' ', 'útero'] }],
}

describe('questionInput (contrato /api/questions)', () => {
  it('aceita pergunta única discursiva e limpa pontos de acerto vazios', () => {
    const r = questionInput.parse(base)
    expect(r.items[0].keyPoints).toEqual(['prolapso', 'útero'])
    expect(r.visibility).toBe('privada')
    expect(r.difficulty).toBe('media')
  })

  it('exige resposta esperada na discursiva', () => {
    const r = questionInput.safeParse({ ...base, items: [{ type: 'discursiva', prompt: '' }] })
    expect(r.success).toBe(false)
    expect(r.error?.issues.map((i) => i.message)).toContain('Resposta: informe a resposta esperada.')
  })

  it('múltipla escolha: ≥ 2 alternativas e exatamente 1 correta (vazias descartadas)', () => {
    const ok = questionInput.safeParse({
      ...base,
      items: [{ type: 'objetiva', alternatives: [{ text: 'A', correct: true }, { text: 'B', correct: false }, { text: '  ', correct: false }] }],
    })
    expect(ok.success).toBe(true)
    expect(ok.data?.items[0].alternatives).toHaveLength(2)

    const twoCorrect = questionInput.safeParse({
      ...base,
      items: [{ type: 'objetiva', alternatives: [{ text: 'A', correct: true }, { text: 'B', correct: true }] }],
    })
    expect(twoCorrect.success).toBe(false)

    const one = questionInput.safeParse({ ...base, items: [{ type: 'objetiva', alternatives: [{ text: 'A', correct: true }] }] })
    expect(one.success).toBe(false)
  })

  it('várias perguntas exigem o texto de cada pergunta', () => {
    const r = questionInput.safeParse({
      ...base,
      items: [
        { label: 'a', type: 'discursiva', prompt: 'Diagnóstico?', expectedAnswer: 'X' },
        { label: 'b', type: 'discursiva', prompt: '', expectedAnswer: 'Y' },
      ],
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toBe('Pergunta b: escreva o texto da pergunta.')
  })

  it('normaliza texto (remove caracteres invisíveis) e rejeita área inválida', () => {
    const r = questionInput.parse({ ...base, stem: 'Enun​ciado   longo' })
    expect(r.stem).toBe('Enunciado   longo')
    expect(questionInput.safeParse({ ...base, areaId: 'a-med' }).success).toBe(false)
  })
})

describe('contentHash', () => {
  it('ignora caixa, acentos, pontuação e respostas', async () => {
    const a = await contentHash({ stem: 'Qual a CONDUTA?', items: [{ prompt: '', alternatives: [{ text: 'Cirurgia.' }] }] })
    const b = await contentHash({ stem: 'qual a conduta', items: [{ prompt: '', alternatives: [{ text: 'cirurgia' }] }] })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('muda quando o conteúdo muda', async () => {
    const a = await contentHash({ stem: 'Enunciado', items: [{ prompt: 'a' }] })
    const b = await contentHash({ stem: 'Enunciado', items: [{ prompt: 'b' }] })
    expect(a).not.toBe(b)
    expect(normalizeForHash('  Ação —  Úteró ')).toBe('acao utero')
  })
})
