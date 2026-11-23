import { describe, expect, it } from 'vitest'
import {
  applyEntry,
  detectDocumentRole,
  findAnswerSection,
  linkAnswers,
  linkSummary,
  NO_ANSWER_IN_KEY,
  parseAnswerKey,
  questionKey,
  segmentImport,
  textOfPages,
  type ImportDocument,
} from '../answer-key'
import { detectDocumentGuide, pagesFromFullText, themeForSection } from '../document-guide'
import { segmentQuestions } from '../segmenter'

/**
 * Spec 002 US6 — questões e respostas em arquivos separados (ou gabarito no fim do PDF).
 * Textos inventados no formato dos materiais reais (estações de OSCE, "QUESTÃO N", grade de letras).
 */

const page = (n: number, text: string) => `\n[[página ${n}]]\n${text}`

const QUESTIONS = [
  page(
    1,
    `Caderno de Treino — Questões
40 estações para treino · gabarito em arquivo separado
Como treinar: leia o caso e responda em voz alta, depois confira no gabarito pelo número.
Temas
1A — Tema Alfa — 2 estações
2 — Tema Beta (com subtítulo longo, que quebra) — 2 estações`,
  ),
  page(
    2,
    `1A — Tema Alfa
Estação 1.1 — Diagnóstico provável
Fonte: Lista 2, Tema Alfa, Cenário 1
Mulher de 40 anos com dor pélvica há 3 meses e sangramento aumentado.
a) Qual o diagnóstico mais provável? Cite dois fatores de risco.
b) Qual exame pedir primeiro?
Estação 1.2 — Caso em etapas com título que quebra
em duas linhas
Fonte: Lista 1, Questão 27
Homem de 50 anos com tosse crônica.
Parte 2: Três hipóteses?
Parte 3: Raio X normal; espirometria com obstrução.
Parte 4: Diagnóstico e conduta?`,
  ),
  page(
    3,
    `2 — Tema Beta (com subtítulo longo,
que quebra)
Estação 2.1 — Pergunta única
Fonte: Nova
Classifique e diga a conduta:
1. Lesão de 2 cm.
2. Lesão de 5 cm.
Estação 2.2 — Quatro etapas na mesma linha
Fonte: Lista 1, Questão 35
Caso 1: valores A · Caso 2: valores B
Parte 2: Método para cada um? Parte 3: Riscos do método de B?`,
  ),
].join('\n')

const ANSWERS = [
  page(
    1,
    `Caderno de Treino — Gabarito
Respostas das 40 estações do arquivo de questões, na mesma numeração
Temas
1A — Tema Alfa — 2 estações
2 — Tema Beta (com subtítulo longo, que quebra) — 2 estações`,
  ),
  page(
    2,
    `1A — Tema Alfa — Gabarito
Quadro de apoio
0 Primeira linha do quadro
1 Segunda linha do quadro
Estação 1.1 — Diagnóstico provável
Fonte: Lista 2, Tema Alfa, Cenário 1
a) Diagnóstico X. Fatores: idade e
obesidade.
b) Ultrassonografia transvaginal.
Estação 1.2 — Caso em etapas com título que quebra
em duas linhas
Fonte: Lista 1, Questão 27
Parte 2: hipótese A, hipótese B, hipótese C.
Parte 4: doença obstrutiva; broncodilatador e cessar tabagismo.`,
  ),
  page(
    3,
    `2 — Tema Beta (com subtítulo longo, que quebra) —
Gabarito
Regra de ouro: sempre confirmar antes de tratar.
Estação 2.1 — Pergunta única
Fonte: Nova
1. Estágio I → observar.
2. Estágio II → operar.
Estação 2.2 — Quatro etapas na mesma linha
Fonte: Lista 1, Questão 35
Parte 2: A = método 1; B = método 2.
Parte 3: risco trombótico; preferir progestagênio.`,
  ),
].join('\n')

const docsFor = (qPages: number, aPages: number): ImportDocument[] => [
  { name: 'questoes.pdf', role: 'questoes', firstPage: 1, lastPage: qPages },
  { name: 'gabarito.pdf', role: 'respostas', firstPage: qPages + 1, lastPage: qPages + aPages },
]
/** Gabarito como 2º arquivo: páginas continuam a numeração. */
const shifted = (text: string, by: number) => text.replace(/\[\[página (\d+)\]\]/g, (_, n) => `[[página ${Number(n) + by}]]`)

describe('chaves de ligação', () => {
  it('normaliza rótulos de tipos diferentes para a mesma chave', () => {
    expect(questionKey('Estação 1B.10')).toBe('1b.10')
    expect(questionKey('QUESTÃO 07')).toBe('7')
    expect(questionKey('Questão 1.1')).toBe('1.1')
    expect(questionKey('12)')).toBe('12')
    expect(questionKey('Estação E.2')).toBe('e.2')
    expect(questionKey('Caso clínico')).toBeNull()
    expect(questionKey(undefined)).toBeNull()
  })
})

describe('segmentador: estações, etapas e temas', () => {
  const qs = segmentQuestions(QUESTIONS, { answers: false, skipPreamble: true })

  it('reconhece "Estação N.N — Título" e tira título e "Fonte:" do enunciado', () => {
    expect(qs.map((q) => q.sourceLabel)).toEqual(['Estação 1.1', 'Estação 1.2', 'Estação 2.1', 'Estação 2.2'])
    expect(qs[0].title).toBe('Diagnóstico provável')
    expect(qs[0].stem).toBe('Mulher de 40 anos com dor pélvica há 3 meses e sangramento aumentado.')
    expect(qs[1].title).toBe('Caso em etapas com título que quebra em duas linhas')
    expect(qs.every((q) => !q.stem.includes('Fonte'))).toBe(true)
  })

  it('"Fonte: Lista 1, Questão 27" não abre questão nova', () => {
    expect(qs).toHaveLength(4)
  })

  it('título de tema vira seção (também quebrado em 2 linhas)', () => {
    expect(qs[0].section).toBe('Tema Alfa')
    expect(qs[2].section).toBe('Tema Beta (com subtítulo longo, que quebra)')
  })

  it('"Parte N" vira pergunta; etapa só com dados vai para a etapa seguinte', () => {
    expect(qs[1].items.map((i) => i.label)).toEqual(['Parte 2', 'Parte 4'])
    expect(qs[1].items[1].prompt).toContain('Parte 3: Raio X normal')
    expect(qs[1].items[1].prompt).toContain('Diagnóstico e conduta?')
  })

  it('"Parte N" depois do fim de uma frase, na mesma linha, também separa', () => {
    expect(qs[3].items.map((i) => i.label)).toEqual(['Parte 2', 'Parte 3'])
  })

  it('estação sem texto comum: o título vira o enunciado (só no arquivo de questões)', () => {
    const t = 'Estação 6.8 — Prevenção\nFonte: Lista 2\na) Qual a prevenção primária?\nb) Quando parar o rastreio?'
    expect(segmentQuestions(t, { answers: false })[0].stem).toBe('Prevenção:')
    expect(parseAnswerKey(`${t}\nEstação 6.9 — Outra\na) x.`)[0].items[0].text).toBe('Qual a prevenção primária?')
  })

  it('"Caso 1:" dentro de uma estação não é cabeçalho', () => {
    expect(qs[3].stem).toContain('Caso 1: valores A')
  })

  it('só questões: o texto depois do "?" continua sendo da pergunta', () => {
    expect(qs[0].items[0].prompt).toBe('Qual o diagnóstico mais provável? Cite dois fatores de risco.')
    expect(qs.flatMap((q) => q.items).every((i) => !i.answer)).toBe(true)
  })
})

describe('guia do documento: temas por código e instruções na mesma linha', () => {
  const guide = detectDocumentGuide(pagesFromFullText(QUESTIONS))
  it('lê a legenda "código — tema — N estações" e marca a capa (não vira questão)', () => {
    expect(guide.themes).toEqual([
      { code: '1A', name: 'Tema Alfa' },
      { code: '2', name: 'Tema Beta (com subtítulo longo, que quebra)' },
    ])
    expect(guide.topics).toEqual([])
    expect(guide.hasFrontMatter).toBe(true)
    expect(guide.instructions).toMatch(/^leia o caso e responda em voz alta/)
  })
  it('tema da seção → assunto do card', () => {
    expect(themeForSection(guide, 'Tema Alfa')).toEqual({ assunto: 'Tema Alfa', source: 'tema 1A' })
    expect(themeForSection(guide, 'Outro')).toBeUndefined()
  })
})

describe('gabarito em outro arquivo', () => {
  it('detecta o papel de cada arquivo', () => {
    expect(detectDocumentRole(QUESTIONS).role).toBe('questoes')
    expect(detectDocumentRole(ANSWERS).role).toBe('respostas')
  })

  it('lê as entradas sem o quadro/resumo do tema e com as etapas puladas (Parte 2, Parte 4)', () => {
    const entries = parseAnswerKey(ANSWERS)
    expect(entries.map((e) => e.key)).toEqual(['1.1', '1.2', '2.1', '2.2'])
    expect(entries[0].items).toEqual([
      { label: 'a', text: 'Diagnóstico X. Fatores: idade e obesidade.' },
      { label: 'b', text: 'Ultrassonografia transvaginal.' },
    ])
    expect(entries[1].items.map((i) => i.label)).toEqual(['parte 2', 'parte 4'])
    expect(entries.flatMap((e) => e.items).some((i) => /Regra de ouro|Quadro de apoio|Gabarito/.test(i.text))).toBe(false)
  })

  it('liga todas as respostas à pergunta certa', () => {
    const full = QUESTIONS + shifted(ANSWERS, 3)
    const r = segmentImport(full, docsFor(3, 3))
    expect(r.link).toMatchObject({ entries: 4, questions: 4, linkedQuestions: 4, answeredItems: 7, totalItems: 7, method: 'numero', orphanEntries: [], unmatchedQuestions: [] })
    const [q1, q2, q3, q4] = r.questions
    expect(q1.items[0]).toMatchObject({ label: 'a', answer: 'Diagnóstico X. Fatores: idade e obesidade.', answerSource: 'gabarito' })
    expect(q2.items.map((i) => i.answer)).toEqual(['hipótese A, hipótese B, hipótese C.', 'doença obstrutiva; broncodilatador e cessar tabagismo.'])
    expect(q3.items[0].answer).toBe('1. Estágio I → observar.\n2. Estágio II → operar.')
    expect(q4.items.map((i) => i.answer)).toEqual(['A = método 1; B = método 2.', 'risco trombótico; preferir progestagênio.'])
    expect(r.questions.every((q) => !q.flags?.length)).toBe(true)
    expect(r.guide.themes?.length).toBe(2)
  })

  it('a ordem dos arquivos não importa (gabarito primeiro)', () => {
    const full = ANSWERS + shifted(QUESTIONS, 3)
    const r = segmentImport(full, [
      { name: 'g.pdf', role: 'respostas', firstPage: 1, lastPage: 3 },
      { name: 'q.pdf', role: 'questoes', firstPage: 4, lastPage: 6 },
    ])
    expect(r.link?.linkedQuestions).toBe(4)
    expect(r.questions.map((q) => q.key)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
  })

  it('questão sem resposta e resposta sem questão ficam no relatório (nada se perde)', () => {
    const answers = ANSWERS.replace('Estação 2.2 —', 'Estação 9.9 —')
    const r = segmentImport(QUESTIONS + shifted(answers, 3), docsFor(3, 3))
    expect(r.link?.linkedQuestions).toBe(3)
    expect(r.link?.unmatchedQuestions.map((q) => q.label)).toEqual(['Estação 2.2'])
    expect(r.link?.orphanEntries.map((o) => o.label)).toEqual(['Estação 9.9'])
    expect(r.orphans[0].text).toContain('risco trombótico')
    expect(r.questions[3].flags).toEqual([NO_ANSWER_IN_KEY])
    expect(linkSummary(r.link!)).toMatch(/3 de 4 questões ligadas.*1 resposta\(s\) sem questão/)
  })

  it('só o arquivo de questões (gabarito esquecido): relatório vazio, nenhuma resposta inventada', () => {
    const r = segmentImport(QUESTIONS, [{ name: 'q.pdf', role: 'questoes', firstPage: 1, lastPage: 3 }])
    expect(r.link).toBeNull()
    expect(r.questions.flatMap((q) => q.items).every((i) => !i.answer)).toBe(true)
  })

  it('recorta o texto de um intervalo de páginas', () => {
    const t = textOfPages(QUESTIONS + shifted(ANSWERS, 3), 4, 6)
    expect(t).toContain('[[página 4]]')
    expect(t).not.toContain('[[página 3]]')
    expect(t).toContain('Gabarito')
  })
})

describe('PDF único com o gabarito no fim', () => {
  const SINGLE = [
    page(
      1,
      `QUESTÃO 1
Paciente de 30 anos com febre e tosse há 5 dias.
a) Qual a hipótese diagnóstica?
b) Qual o tratamento?
QUESTÃO 2
Gestante de 28 semanas com pressão 160 x 110 mmHg. Qual a conduta inicial?
QUESTÃO 3
Criança de 4 anos com chiado recorrente. Cite dois diagnósticos diferenciais.`,
    ),
    page(
      2,
      `GABARITO
QUESTÃO 1
a) Pneumonia adquirida na comunidade.
b) Amoxicilina por 7 dias.
QUESTÃO 2
Sulfato de magnésio e anti-hipertensivo; avaliar interrupção.
QUESTÃO 3
Asma e corpo estranho.`,
    ),
  ].join('\n')

  it('acha o início da seção de respostas e liga tudo', () => {
    expect(findAnswerSection(SINGLE)?.page).toBe(2)
    expect(detectDocumentRole(SINGLE).role).toBe('misto')
    const r = segmentImport(SINGLE)
    expect(r.answerSectionPage).toBe(2)
    expect(r.questions).toHaveLength(3)
    expect(r.questions[0].items.map((i) => i.answer)).toEqual(['Pneumonia adquirida na comunidade.', 'Amoxicilina por 7 dias.'])
    expect(r.questions[1].items[0].answer).toBe('Sulfato de magnésio e anti-hipertensivo; avaliar interrupção.')
    expect(r.link?.linkedQuestions).toBe(3)
  })

  it('PDF com resposta logo depois da pergunta continua como antes (sem seção de gabarito)', () => {
    const inline = page(
      1,
      `QUESTÃO 1
Paciente de 30 anos com febre e tosse há 5 dias.
a) Qual a hipótese diagnóstica?
Pneumonia adquirida na comunidade, pela febre e tosse.
b) Qual o tratamento?
Amoxicilina por 7 dias, com reavaliação em 48 horas.
QUESTÃO 2
Gestante de 28 semanas com pressão 160 x 110 mmHg. Qual a conduta inicial?
Sulfato de magnésio e anti-hipertensivo; avaliar interrupção da gestação.`,
    )
    expect(findAnswerSection(inline)).toBeNull()
    const r = segmentImport(inline)
    expect(r.link).toBeNull()
    expect(r.questions.map((q) => q.items.map((i) => i.answer))).toEqual(segmentQuestions(inline).map((q) => q.items.map((i) => i.answer)))
    expect(detectDocumentRole(inline).role).toBe('misto')
  })

  it('"Resposta comentada" dentro da questão: cada etapa recebe a resposta de mesmo rótulo', () => {
    const t = page(
      1,
      `Questão 01
Parte 1: Mulher de 52 anos com perda urinária aos esforços.
Parte 2: Quais exames pedir?
Parte 3: Qual o diagnóstico? Qual o tratamento?
Resposta comentada
Parte 2 - Investigação. Diário miccional e exame com tosse.
Parte 3 - Diagnóstico. Incontinência de esforço; fisioterapia pélvica.
Questão 02
Paciente de 30 anos com dor pélvica cíclica. Qual a principal hipótese?
Resposta comentada
Endometriose, pela dor cíclica.`,
    )
    const qs = segmentImport(t).questions
    expect(qs[0].items.map((i) => [i.label, i.answer])).toEqual([
      ['Parte 2', 'Investigação. Diário miccional e exame com tosse.'],
      ['Parte 3', 'Diagnóstico. Incontinência de esforço; fisioterapia pélvica.'],
    ])
    expect(qs[0].stem).toContain('Mulher de 52 anos')
    expect(qs[1].items[0].answer).toBe('Endometriose, pela dor cíclica.')
  })
})

describe('gabarito de letras e numeração diferente', () => {
  const OBJ = page(
    1,
    `QUESTÃO 1
Qual o agente mais comum da pneumonia adquirida na comunidade?
a) Pneumococo
b) Haemophilus
c) Klebsiella
d) Legionella
QUESTÃO 2
Assinale o exame inicial na suspeita de TEP de baixa probabilidade:
a) D-dímero
b) Angiotomografia
c) Cintilografia`,
  )

  it('grade "1-A 2-C" vira objetiva com a alternativa correta marcada', () => {
    const key = page(2, 'GABARITO\n1-A 2-A')
    const r = segmentImport(OBJ + key, [
      { name: 'q.pdf', role: 'questoes', firstPage: 1, lastPage: 1 },
      { name: 'g.pdf', role: 'respostas', firstPage: 2, lastPage: 2 },
    ])
    expect(r.questions[0].items).toHaveLength(1)
    expect(r.questions[0].items[0].choices?.map((c) => c.label)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.questions[0].items[0].correct).toBe('A')
    expect(r.questions[1].items[0].correct).toBe('A')
    expect(detectDocumentRole(key).role).toBe('respostas')
  })

  it('gabarito numerado com deslocamento constante (41, 42 × 1, 2)', () => {
    const key = parseAnswerKey('41) A\n42) A\n43) C')
    const qs = segmentQuestions(OBJ, { answers: false })
    const r = linkAnswers(qs, key)
    expect(r.report.method).toBe('deslocamento')
    expect(r.report.offset).toBe(40)
    expect(r.questions[0].items[0].correct).toBe('A')
    expect(r.questions[0].flags?.[0]).toMatch(/deslocada/)
    expect(r.orphans.map((o) => o.key)).toEqual(['43'])
  })

  it('numeração que recomeça por seção: k-ésima "Questão 1" ↔ k-ésima resposta "1"', () => {
    const qs = segmentQuestions(
      `QUESTÃO 1\nPrimeira questão da unidade um, com texto suficiente. Qual a conduta?\nQUESTÃO 1\nPrimeira questão da unidade dois, com texto suficiente. Qual a conduta?`,
      { answers: false },
    )
    const key = parseAnswerKey('QUESTÃO 1\nResposta da unidade um.\nQUESTÃO 1\nResposta da unidade dois.')
    const r = linkAnswers(qs, key)
    expect(r.questions.map((q) => q.items[0].answer)).toEqual(['Resposta da unidade um.', 'Resposta da unidade dois.'])
  })

  it('sem números em comum e mesma quantidade: liga pela ordem e pede conferência', () => {
    const qs = segmentQuestions('QUESTÃO 1\nTexto da questão um, longo o bastante. Qual a conduta?\nQUESTÃO 2\nTexto da questão dois, longo o bastante. Qual a conduta?', { answers: false })
    const r = linkAnswers(qs, [
      { id: 'r1', key: null, items: [{ text: 'Resposta um.' }], text: 'Resposta um.' },
      { id: 'r2', key: null, items: [{ text: 'Resposta dois.' }], text: 'Resposta dois.' },
    ])
    expect(r.report.method).toBe('ordem')
    expect(r.questions[1].items[0].answer).toBe('Resposta dois.')
    expect(r.questions[0].flags?.[0]).toMatch(/ORDEM/)
  })

  it('resposta sem separação por item numa questão com várias perguntas: tudo na 1ª, com aviso', () => {
    const q = segmentQuestions('QUESTÃO 5\nCaso clínico com texto suficiente para virar questão.\na) Primeira?\nb) Segunda?', { answers: false })[0]
    const out = applyEntry(q, { id: 'r1', key: '5', items: [{ text: 'Resposta corrida para as duas.' }], text: 'Resposta corrida para as duas.' })
    expect(out.items[0].answer).toBe('Resposta corrida para as duas.')
    expect(out.flags?.[0]).toMatch(/sem separação por pergunta/)
  })
})
