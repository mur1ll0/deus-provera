import { describe, expect, it } from 'vitest'
import { commitIssues, importCommitInput, toCommitInput, type DraftLike } from '../schemas/import-commit'

const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  stem: 'Paciente de 62 anos com sensação de bola na vagina.',
  items: [{ prompt: '', type: 'discursiva', expectedAnswer: 'Prolapso uterino', keyPoints: ['prolapso'] }],
  difficulty: 'media',
  visibility: 'publica',
  ...over,
})

describe('toCommitInput (revisão → corpo do commit)', () => {
  it('converte cards e rascunhos, omite cards vazios e devolve as referências', () => {
    const { body, refs } = toCommitInput(
      [
        { area: 'Medicina', discipline: 'Ginecologia', topic: 'Prolapso', description: '', questionIds: ['d1', 'd2'] },
        { area: 'Medicina', discipline: 'Obstetrícia', topic: '', questionIds: ['inexistente'] },
      ],
      {
        d1: draft(),
        d2: draft({ items: [{ prompt: '', type: 'objetiva', alternatives: [{ text: 'A', correct: true, source: 'usuario' }, { text: 'B', correct: false, source: 'ia' }] }] }),
      },
    )
    expect(refs).toEqual([['d1', 'd2']])
    expect(body.cards).toHaveLength(1)
    expect(body.cards[0]).toMatchObject({ area: 'Medicina', discipline: 'Ginecologia', topic: 'Prolapso', description: undefined })
    const parsed = importCommitInput.parse(body)
    expect(parsed.cards[0].questions[1].items[0].alternatives).toHaveLength(2)
    expect(parsed.cards[0].questions[0].visibility).toBe('publica')
  })
})

describe('importCommitInput (validação do commit)', () => {
  it('aponta a questão inválida por card/questão', () => {
    const { body } = toCommitInput(
      [{ area: 'Medicina', discipline: 'Ginecologia', questionIds: ['ok', 'ruim'] }],
      { ok: draft(), ruim: draft({ items: [{ prompt: '', type: 'discursiva', expectedAnswer: '' }] }) },
    )
    const r = importCommitInput.safeParse(body)
    expect(r.success).toBe(false)
    expect(commitIssues(r.error!)).toEqual([{ card: 0, question: 1, message: 'Resposta: informe a resposta esperada.' }])
  })

  it('rejeita o card "Revisar categoria" sem área/disciplina definida', () => {
    const { body } = toCommitInput([{ area: 'Sem área', discipline: 'Sem disciplina', questionIds: ['a'] }], { a: draft() })
    const issues = commitIssues(importCommitInput.safeParse(body).error!)
    expect(issues.map((i) => i.message)).toEqual(['Escolha a área do card "Revisar categoria".', 'Escolha a disciplina do card "Revisar categoria".'])
    expect(issues.every((i) => i.card === 0 && i.question === undefined)).toBe(true)
  })

  it('aceita rótulos de pergunta do contrato de importação (até 10, ex.: "Paciente 1")', () => {
    const items = [1, 2].map((n) => ({ label: `Paciente ${n}`, prompt: 'Qual o diagnóstico?', type: 'discursiva' as const, expectedAnswer: 'Prolapso' }))
    const { body } = toCommitInput([{ area: 'Medicina', discipline: 'Ginecologia', questionIds: ['a'] }], { a: draft({ items }) })
    expect(importCommitInput.safeParse(body).success).toBe(true)
  })

  it('traduz as mensagens padrão do zod, indica a pergunta e não repete o mesmo problema', () => {
    const items = [1, 2].map((n) => ({ label: 'x'.repeat(30), prompt: `Pergunta ${n}`, type: 'discursiva' as const, expectedAnswer: 'Prolapso' }))
    const { body } = toCommitInput([{ area: 'Medicina', discipline: 'Ginecologia', questionIds: ['a'] }], { a: draft({ items }) })
    const issues = commitIssues(importCommitInput.safeParse(body).error!)
    expect(issues).toEqual([
      { card: 0, question: 0, message: 'Pergunta 1 · Rótulo: no máximo 20 caracteres.' },
      { card: 0, question: 0, message: 'Pergunta 2 · Rótulo: no máximo 20 caracteres.' },
    ])
  })

  it('exige ao menos um card com questões', () => {
    expect(importCommitInput.safeParse({ cards: [] }).success).toBe(false)
  })
})
