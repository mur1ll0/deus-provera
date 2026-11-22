import { describe, expect, it } from 'vitest'
import { cleanItemLabel, parseImportText } from '../schemas/import'
import { reflow, segmentQuestions, splitPromptAnswer } from '../segmenter'

const valid = {
  versao: '2.0',
  questoes: [
    {
      area: 'Medicina',
      disciplina: 'Ginecologia',
      rotulo: 'QUESTÃO 8',
      enunciado: 'Joana tem 45 anos… A colpocitologia mostrou ASCUS. Responda:',
      perguntas: [
        { rotulo: 'a', texto: 'Há necessidade de outro exame? Justifique.', tipo: 'discursiva', resposta_esperada: 'Sim, DNA-HPV.', pontos_chave: ['DNA-HPV'] },
        {
          rotulo: 'b',
          texto: 'O que significa este resultado?',
          tipo: 'discursiva',
          resposta_esperada: 'Achado de grau maior.',
          alternativas: [
            { texto: 'Grau maior', correta: true, gerada_por_ia: true },
            { texto: 'Grau menor', correta: false, gerada_por_ia: true },
          ],
        },
      ],
    },
    {
      area: 'Medicina',
      disciplina: 'Ginecologia',
      enunciado: 'Ponto zero do POP-Q?',
      perguntas: [{ tipo: 'objetiva', alternativas: [{ texto: 'Hímen', correta: true }, { texto: 'Colo', correta: false }] }],
    },
  ],
}

describe('parseImportText (formato v2: enunciado + perguntas)', () => {
  it('aceita JSON dentro de bloco ```json (resposta típica de chatbot)', () => {
    const r = parseImportText('Aqui está:\n```json\n' + JSON.stringify(valid) + '\n```')
    expect(r.ok).toBe(true)
    expect(r.data?.questoes).toHaveLength(2)
    expect(r.data?.questoes[0].perguntas).toHaveLength(2)
    expect(r.data?.questoes[1].perguntas[0].texto).toBe('') // pergunta única
  })

  it('une respostas em várias partes (vários blocos ```json)', () => {
    const part = (q: unknown) => '```json\n' + JSON.stringify({ versao: '2.0', questoes: [q] }) + '\n```'
    const r = parseImportText(`Parte 1/2\n${part(valid.questoes[0])}\nParte 2/2\n${part(valid.questoes[1])}`)
    expect(r.ok).toBe(true)
    expect(r.data?.questoes).toHaveLength(2)
  })

  it('rejeita o formato antigo 1.0 com mensagem clara', () => {
    const r = parseImportText(JSON.stringify({ ...valid, versao: '1.0' }))
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toMatch(/2\.0/)
  })

  it('alternativas de uma pergunta exigem exatamente 1 correta', () => {
    const bad = structuredClone(valid) as typeof valid
    bad.questoes[0].perguntas[1].alternativas![1].correta = true
    const r = parseImportText(JSON.stringify(bad))
    expect(r.ok).toBe(false)
    expect(r.errors[0].path).toContain('perguntas.1.alternativas')
  })

  it('pergunta discursiva sem resposta esperada é rejeitada', () => {
    const bad = structuredClone(valid) as { versao: string; questoes: { perguntas: Record<string, unknown>[] }[] }
    delete bad.questoes[0].perguntas[0].resposta_esperada
    expect(parseImportText(JSON.stringify(bad)).ok).toBe(false)
  })

  it('com várias perguntas, todas precisam de texto', () => {
    const bad = structuredClone(valid) as { versao: string; questoes: { perguntas: { texto?: string }[] }[] }
    bad.questoes[0].perguntas[0].texto = ''
    expect(parseImportText(JSON.stringify(bad)).ok).toBe(false)
  })

  it('reporta JSON malformado', () => {
    expect(parseImportText('{ nope').errors[0].path).toBe('(raiz)')
  })

  it('enunciado vazio com UMA pergunta: o texto da pergunta sobe para o enunciado', () => {
    const q = { ...valid.questoes[1], enunciado: '', perguntas: [{ ...valid.questoes[1].perguntas[0], texto: 'Qual é o ponto zero do POP-Q?' }] }
    const r = parseImportText(JSON.stringify({ versao: '2.0', questoes: [q] }))
    expect(r.ok).toBe(true)
    expect(r.data?.questoes[0].enunciado).toBe('Qual é o ponto zero do POP-Q?')
    expect(r.data?.questoes[0].perguntas[0].texto).toBe('')
  })

  it('enunciado de enfeite com várias perguntas vira "Responda às perguntas a seguir sobre <assunto>."', () => {
    for (const enunciado of ['', '.', '—', 'QUESTÃO 3']) {
      const q = { ...valid.questoes[0], assunto: 'Rastreamento do câncer de colo', enunciado }
      const r = parseImportText(JSON.stringify({ versao: '2.0', questoes: [q] }))
      expect(r.ok).toBe(true)
      expect(r.data?.questoes[0].enunciado).toBe('Responda às perguntas a seguir sobre Rastreamento do câncer de colo.')
      expect(r.data?.questoes[0].perguntas).toHaveLength(2)
    }
  })
})

describe('splitPromptAnswer', () => {
  it('inclui "Justifique." na pergunta (caso real do III UNIDADE.pdf, QUESTÃO 8a)', () => {
    const r = splitPromptAnswer('A paciente apresenta um quadro clínico… Diante desta\ncerteza, há necessidade de solicitar algum outro exame? Justifique.\nSim, há necessidade de solicitar o DNA-HPV.')
    expect(r.prompt).toMatch(/Justifique\.$/)
    expect(r.answer).toBe('Sim, há necessidade de solicitar o DNA-HPV.')
  })
  it('pergunta com duas interrogações na mesma linha (QUESTÃO 8b)', () => {
    const r = splitPromptAnswer('Elas perguntam:\no que significa este resultado? O que deve ser feito agora?\nO achado é de grau maior.')
    expect(r.prompt).toMatch(/feito agora\?$/)
    expect(r.answer).toBe('O achado é de grau maior.')
  })
})

describe('segmentQuestions', () => {
  const text = `[[página 7]]
QUESTÃO 8. Joana tem 45 anos e menstrua regularmente. A colpocitologia mostrou ASCUS.
Responda:
a. A paciente não tem atividade sexual com penetração. Há necessidade de solicitar algum outro exame? Justifique.
Sim, o teste de DNA-HPV de alto risco.
b. Elas perguntam: o que significa este resultado? O que deve ser feito agora?
Achado de grau maior; fazer biópsia.
[[página 8]]
QUESTÃO 9. Mulher de 45 anos com hipermenorragia há 8 meses. Qual a conduta?
Histeroscopia diagnóstica.`

  it('separa enunciado e perguntas com suas respostas', () => {
    const qs = segmentQuestions(text)
    expect(qs).toHaveLength(2)
    expect(qs[0]).toMatchObject({ sourceLabel: 'QUESTÃO 8', page: 7 })
    expect(qs[0].stem).toMatch(/^Joana tem 45 anos.*Responda:$/s)
    expect(qs[0].items).toHaveLength(2)
    expect(qs[0].items[0]).toMatchObject({ label: 'a', answer: 'Sim, o teste de DNA-HPV de alto risco.' })
    expect(qs[0].items[0].prompt).toMatch(/Justifique\.$/)
    expect(qs[0].items[1].prompt).toMatch(/feito agora\?$/)
  })

  it('questão sem subitens vira enunciado + pergunta única', () => {
    const q = segmentQuestions(text)[1]
    expect(q.stem).toMatch(/Qual a conduta\?$/)
    expect(q.items).toEqual([{ prompt: '', answer: 'Histeroscopia diagnóstica.' }])
    expect(q.page).toBe(8)
  })

  it('reflow junta quebras de linha no meio da frase e preserva enumerações', () => {
    expect(reflow('paciente com\nprolapso. Conduta:\na) colporrafia')).toBe('paciente com prolapso. Conduta:\na) colporrafia')
  })
})

describe('cleanItemLabel', () => {
  it('tira a pontuação que a tela já põe ("b))" na revisão)', () => {
    expect(['b)', '(c)', '2.', ' a ', 'b2)', 'QUESTÃO 1', '', null, ')'].map(cleanItemLabel)).toEqual(['b', 'c', '2', 'a', 'b2', 'QUESTÃO 1', null, null, null])
  })
})
