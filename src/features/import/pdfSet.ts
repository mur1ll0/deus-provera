import { detectDocumentRole, type DocumentRole, type ImportDocument } from '@shared/answer-key'
import { imageId } from '@shared/page-images'
import { popqLayoutToLine } from '@shared/tables'
import type { ExtractedPdf, PdfPart } from './pdfExtract'

/**
 * VÁRIOS PDFs NUMA IMPORTAÇÃO (spec 002 US6) — ex.: questões num arquivo e gabarito em outro.
 *
 * Cada arquivo é extraído sozinho (pdfExtract.ts) e depois juntado aqui num único `ExtractedPdf` com as
 * páginas na numeração GLOBAL (o 2º arquivo continua de onde o 1º parou). Assim o servidor, a visão
 * (`[[imagem pN-k]]`) e o checkpoint funcionam como num PDF só; `parts` diz de qual arquivo é cada página
 * e qual o papel dele (questões, gabarito ou os dois). Sem DOM nem pdf.js: testável em Node.
 */

export const MAX_PDFS = 5
export const MAX_TOTAL_PAGES = 400

/** Um arquivo extraído + o papel escolhido (padrão: o detectado). */
export interface PdfInput {
  pdf: ExtractedPdf
  role?: DocumentRole
}

/** Papel sugerido para cada arquivo. Um arquivo só: "misto" (comportamento de sempre + gabarito no fim). */
export function suggestRoles(pdfs: ExtractedPdf[]): { role: DocumentRole; reason: string }[] {
  if (pdfs.length === 1) return [{ role: 'misto', reason: 'arquivo único' }]
  return pdfs.map((p) => detectDocumentRole(p.fullText))
}

/** Junta os arquivos na ordem dada, com as páginas (e os ids das imagens) renumeradas. */
export function mergePdfs(inputs: PdfInput[]): ExtractedPdf {
  if (inputs.length === 1 && !inputs[0].role) return inputs[0].pdf
  const detected = suggestRoles(inputs.map((i) => i.pdf))
  let offset = 0
  const parts: PdfPart[] = []
  const pages: ExtractedPdf['pages'] = []
  inputs.forEach(({ pdf, role }, i) => {
    parts.push({ fileName: pdf.fileName, sizeBytes: pdf.sizeBytes, role: role ?? detected[i].role, detected: detected[i], firstPage: offset + 1, pageCount: pdf.pages.length, file: pdf.file })
    for (const p of pdf.pages) {
      const page = p.page + offset
      const ids = new Map(p.imageRegions.map((r, k) => [r.id, imageId(page, k)]))
      pages.push({
        ...p,
        page,
        imageRegions: p.imageRegions.map((r, k) => ({ ...r, id: imageId(page, k) })),
        markedText: p.markedText.replace(/\[\[imagem (p\d+-\d+)\]\]/g, (m, id: string) => (ids.has(id) ? `[[imagem ${ids.get(id)}]]` : m)),
      })
    }
    offset += pdf.pages.length
  })
  return {
    fileName: inputs.map((i) => i.pdf.fileName).join(' + ').slice(0, 200),
    sizeBytes: inputs.reduce((a, i) => a + i.pdf.sizeBytes, 0),
    pages,
    fullText: pages.map((p) => `\n[[página ${p.page}]]\n${popqLayoutToLine(p.text)}`).join('\n'),
    file: inputs[0].pdf.file,
    parts,
  }
}

/** Intervalos de página de cada arquivo (corpo `documents` de POST /api/imports e `segmentImport`). */
export function documentsOf(parts: PdfPart[]): ImportDocument[] {
  return parts.map((p) => ({ name: p.fileName.slice(0, 200), role: p.role, firstPage: p.firstPage, lastPage: p.firstPage + p.pageCount - 1 }))
}

/** Arquivo e página local de uma página global (recortes de imagem: cada um vem do seu PDF). */
export function locatePage(pdf: Pick<ExtractedPdf, 'file' | 'parts'>, page: number): { file: File; page: number; part: number } {
  const parts = pdf.parts ?? []
  const i = parts.findIndex((p) => page >= p.firstPage && page < p.firstPage + p.pageCount)
  return i < 0 ? { file: pdf.file, page, part: 0 } : { file: parts[i].file, page: page - parts[i].firstPage + 1, part: i }
}

/** O que falta para processar (mensagem para a tela) — ou null se está tudo certo. */
export function setProblem(parts: Pick<PdfPart, 'role' | 'pageCount'>[]): string | null {
  if (parts.length > MAX_PDFS) return `Envie no máximo ${MAX_PDFS} PDFs por importação.`
  if (parts.reduce((a, p) => a + p.pageCount, 0) > MAX_TOTAL_PAGES) return `Os arquivos somam mais de ${MAX_TOTAL_PAGES} páginas. Divida a importação.`
  if (parts.length && parts.every((p) => p.role === 'respostas')) return 'Só há gabarito: envie também o PDF com as questões (ou mude o papel de um arquivo).'
  return null
}
