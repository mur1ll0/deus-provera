import { describe, expect, it } from 'vitest'
import { segmentImport } from '@shared/answer-key'
import { pdfJobPayload } from '../importJob'
import type { ExtractedPdf } from '../pdfExtract'
import { documentsOf, locatePage, mergePdfs, setProblem, suggestRoles } from '../pdfSet'

/** Spec 002 US6: vários PDFs (questões + gabarito) viram uma importação com numeração de página global. */

function fakePdf(name: string, pages: string[], images: Record<number, number> = {}): ExtractedPdf {
  const ps = pages.map((text, i) => {
    const page = i + 1
    const regions = Array.from({ length: images[page] ?? 0 }, (_, k) => ({ id: `p${page}-${k + 1}`, rect: { x: 0, y: 0, w: 100, h: 100 } }))
    return { page, text, markedText: `${text}${regions.map((r) => `\n[[imagem ${r.id}]]`).join('')}`, chars: text.length, images: regions.length, imageRegions: regions, needsOcr: false }
  })
  return { fileName: name, sizeBytes: 1000, pages: ps, fullText: ps.map((p) => `\n[[página ${p.page}]]\n${p.text}`).join('\n'), file: new File(['x'], name) }
}

const questions = fakePdf(
  'questoes.pdf',
  [
    'QUESTÃO 1\nPaciente de 30 anos com febre e tosse há cinco dias.\na) Qual a hipótese diagnóstica?\nb) Qual o tratamento?',
    'QUESTÃO 2\nGestante de 28 semanas com pressão de 160 x 110 mmHg. Qual a conduta inicial?',
  ],
  { 2: 1 },
)
const key = fakePdf('gabarito.pdf', ['Gabarito\nQUESTÃO 1\na) Pneumonia.\nb) Amoxicilina.\nQUESTÃO 2\nSulfato de magnésio.'], { 1: 1 })

describe('mergePdfs', () => {
  it('um arquivo sem papel escolhido fica como está (comportamento de sempre)', () => {
    expect(mergePdfs([{ pdf: questions }])).toBe(questions)
    expect(suggestRoles([questions])).toEqual([{ role: 'misto', reason: 'arquivo único' }])
  })

  it('numera as páginas em sequência e renomeia os ids das imagens', () => {
    const m = mergePdfs([{ pdf: questions }, { pdf: key }])
    expect(m.fileName).toBe('questoes.pdf + gabarito.pdf')
    expect(m.pages.map((p) => p.page)).toEqual([1, 2, 3])
    expect(m.pages[2].imageRegions[0].id).toBe('p3-1')
    expect(m.pages[2].markedText).toContain('[[imagem p3-1]]')
    expect(m.pages[1].imageRegions[0].id).toBe('p2-1')
    expect(m.fullText).toContain('[[página 3]]\nGabarito')
    expect(m.parts?.map((p) => [p.role, p.firstPage, p.pageCount])).toEqual([
      ['questoes', 1, 2],
      ['respostas', 3, 1],
    ])
    expect(documentsOf(m.parts!)).toEqual([
      { name: 'questoes.pdf', role: 'questoes', firstPage: 1, lastPage: 2 },
      { name: 'gabarito.pdf', role: 'respostas', firstPage: 3, lastPage: 3 },
    ])
  })

  it('cada página global aponta para o seu arquivo (recortes de imagem)', () => {
    const m = mergePdfs([{ pdf: questions }, { pdf: key }])
    expect(locatePage(m, 3)).toEqual({ file: key.file, page: 1, part: 1 })
    expect(locatePage(m, 2)).toEqual({ file: questions.file, page: 2, part: 0 })
  })

  it('o papel escolhido pelo usuário vence o sugerido', () => {
    const m = mergePdfs([{ pdf: questions, role: 'misto' }, { pdf: key }])
    expect(m.parts?.[0].role).toBe('misto')
    expect(m.parts?.[0].detected.role).toBe('questoes')
  })

  it('a mesma segmentação do servidor liga o gabarito (resumo antes de processar)', () => {
    const m = mergePdfs([{ pdf: questions }, { pdf: key }])
    const r = segmentImport(m.fullText, documentsOf(m.parts!))
    expect(r.link?.linkedQuestions).toBe(2)
    expect(r.questions[0].items.map((i) => i.answer)).toEqual(['Pneumonia.', 'Amoxicilina.'])
  })

  it('aponta o que impede processar', () => {
    expect(setProblem([{ role: 'respostas', pageCount: 3 }])).toMatch(/Só há gabarito/)
    expect(setProblem([{ role: 'questoes', pageCount: 300 }, { role: 'respostas', pageCount: 200 }])).toMatch(/400 páginas/)
    expect(setProblem([{ role: 'questoes', pageCount: 3 }, { role: 'respostas', pageCount: 2 }])).toBeNull()
  })
})

describe('pdfJobPayload com vários PDFs', () => {
  it('manda `documents` e o manifesto das imagens na numeração global', () => {
    const m = mergePdfs([{ pdf: questions }, { pdf: key }])
    const p = pdfJobPayload(m)
    expect(p.documents).toEqual(documentsOf(m.parts!))
    expect(p.images).toEqual([
      { id: 'p2-1', page: 2 },
      { id: 'p3-1', page: 3 },
    ])
    expect(p.pages.map((x) => x.page)).toEqual([1, 2, 3])
  })

  it('um PDF só (misto) não manda `documents`', () => {
    expect('documents' in pdfJobPayload(questions)).toBe(false)
    expect('documents' in pdfJobPayload(mergePdfs([{ pdf: questions, role: 'misto' }]))).toBe(false)
    expect(pdfJobPayload(mergePdfs([{ pdf: questions, role: 'questoes' }])).documents?.[0].role).toBe('questoes')
  })
})
