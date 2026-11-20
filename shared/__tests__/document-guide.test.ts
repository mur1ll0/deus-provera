import { describe, expect, it } from 'vitest'
import { detectDocumentGuide, expandNumbers, numberQuestions, pagesFromFullText, questionNumber, resolveGuideTaxonomy, topicForQuestion } from '../document-guide'
import { segmentQuestions } from '../segmenter'

/** Texto sintético no formato dos materiais com "Como usar" + "Lista de questões" (spec 002 FR-018a). */
const HEADER = 'Banco de Casos - Ginecologia | Casos comentados'
const page = (n: number, body: string) => `\n[[página ${n}]]\n${HEADER}\n${body}\nPágina ${n}\n`
const DOC = [
  page(1, 'CASOS CLÍNICOS\nGINECOLOGIA\nRespostas comentadas\nMaterial de estudo - março de 2026'),
  page(
    2,
    [
      'Como usar este material',
      'Cada caso traz o enunciado seguido de uma resposta comentada. Confira as',
      'condutas com os protocolos do seu serviço.',
      'Lista de questões',
      'Questões Temas principais',
      '01-03 Prolapso genital',
      '04-05 Sangramento uterino anormal e',
      'endométrio',
      '6,8 e 10 Vaginites',
      '07,09 Climatério',
    ].join('\n'),
  ),
  ...Array.from({ length: 10 }, (_, i) =>
    page(3 + i, `Questão ${String(i + 1).padStart(2, '0')}\nMulher de ${30 + i} anos com queixa ginecológica há meses, sem outras comorbidades.\nQual a conduta?\nResposta comentada: conduta conforme o protocolo do serviço e reavaliação.`),
  ),
].join('')

const TAXONOMY = [
  { area: 'Medicina', discipline: 'Ginecologia' },
  { area: 'Medicina', discipline: 'Obstetrícia' },
  { area: 'Medicina', discipline: 'Farmacologia' },
  { area: 'Enfermagem', discipline: 'Farmacologia' },
]

describe('guia do documento (capa, instruções, legenda de temas)', () => {
  const guide = detectDocumentGuide(pagesFromFullText(DOC))

  it('lê a legenda: faixas, listas com "e", tema quebrado em duas linhas', () => {
    expect(guide.topics.map((t) => [t.source, t.assunto, t.numbers])).toEqual([
      ['01-03', 'Prolapso genital', [1, 2, 3]],
      ['04-05', 'Sangramento uterino anormal e endométrio', [4, 5]],
      ['6,8e10', 'Vaginites', [6, 8, 10]],
      ['07,09', 'Climatério', [7, 9]],
    ])
    expect(guide.page).toBe(2)
    expect(topicForQuestion(guide, 8)?.assunto).toBe('Vaginites')
    expect(topicForQuestion(guide, 11)).toBeUndefined()
  })

  it('separa as instruções do material (sem cabeçalho/rodapé repetido)', () => {
    expect(guide.instructions).toBe('Cada caso traz o enunciado seguido de uma resposta comentada. Confira as condutas com os protocolos do seu serviço.')
    expect(guide.title).toBe(HEADER)
    expect(guide.hasFrontMatter).toBe(true)
  })

  it('reconhece a disciplina do título na taxonomia existente (mesma grafia) e a área dela', () => {
    expect(resolveGuideTaxonomy(guide, TAXONOMY)).toEqual({ area: 'Medicina', disciplina: 'Ginecologia' })
  })

  it('"Disciplina:" explícita vence o título; disciplina em duas áreas usa a área citada', () => {
    // sem o cabeçalho "…Ginecologia" do helper `page`
    const raw = (body: string) => pagesFromFullText(`[[página 1]]\n${body}`)
    const g = detectDocumentGuide(raw('Apostila\nDisciplina: farmacologia\nÁrea: Enfermagem\nQuestão 1\nCaso clínico longo o bastante para virar questão. Qual a conduta?'))
    expect(resolveGuideTaxonomy(g, TAXONOMY)).toEqual({ area: 'Enfermagem', disciplina: 'Farmacologia' })
    const ambiguous = detectDocumentGuide(raw('FARMACOLOGIA\nQuestão 1\nCaso clínico. Qual a conduta?'))
    expect(resolveGuideTaxonomy(ambiguous, TAXONOMY)).toEqual({ area: undefined, disciplina: 'Farmacologia' })
  })

  it('a capa/guia não vira questão na segmentação', () => {
    const qs = segmentQuestions(DOC, { skipPreamble: guide.hasFrontMatter })
    expect(qs.map((q) => q.sourceLabel)).toEqual(Array.from({ length: 10 }, (_, i) => `QUESTÃO ${String(i + 1).padStart(2, '0')}`))
    expect(segmentQuestions(DOC)[0].sourceLabel).toBeUndefined() // sem o guia, a capa virava a 1ª "questão"
  })

  it('sumário por página, linha numerada solta e "ASSUNTO:" de seção não são legenda', () => {
    const toc = detectDocumentGuide(pagesFromFullText(page(1, 'Sumário\nProlapso ........ 3\nVaginites ........ 9\nQuestão 1\nCaso. Qual?')))
    expect(toc.topics).toEqual([])
    const one = detectDocumentGuide(pagesFromFullText(page(1, '1 Introdução\nQuestão 1\nCaso. Qual?')))
    expect(one.topics).toEqual([])
    const section = detectDocumentGuide(pagesFromFullText(page(1, 'PROLAPSO GENITAL\nASSUNTO: PROF. FULANA\nObserve o esquema abaixo. Para cada um: dê o diagnóstico.')))
    expect(section.hasFrontMatter).toBe(false)
    expect(section.explicit).toEqual({})
  })
})

describe('números das questões', () => {
  it('expande faixas e listas; rejeita faixas invertidas', () => {
    expect(expandNumbers('12,18, 38 e 48-50')).toEqual([12, 18, 38, 48, 49, 50])
    expect(expandNumbers('5 a 7')).toEqual([5, 6, 7])
    expect(expandNumbers('9-3')).toBeNull()
  })

  it('rótulos: "QUESTÃO 07" → 7; em material com "QUESTÃO N", "1)…4)" são partes da questão anterior', () => {
    expect(questionNumber('QUESTÃO 07')).toBe(7)
    expect(questionNumber('Questão 1.2')).toBe(1)
    expect(questionNumber('12)')).toBe(12)
    expect(numberQuestions(['QUESTÃO 34', 'QUESTÃO 35', '1)', '2)', 'QUESTÃO 36', undefined])).toEqual([34, 35, 35, 35, 36, 36])
    expect(numberQuestions(['1)', '2)', '3)'])).toEqual([1, 2, 3])
  })
})
