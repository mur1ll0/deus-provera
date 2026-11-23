import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { composePageText, findImageRects, imageId, usefulImageRects, type ImageRect, type TextRun } from '@shared/page-images'
import { popqLayoutToLine } from '@shared/tables'
import type { DocumentRole } from '@shared/answer-key'

GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Extração de texto 100% no navegador (pdf.js) — custo zero, sem upload do PDF.
 * Também detecta páginas com imagens e páginas "sem texto" (provável escaneado), e localiza cada
 * imagem útil na página: o texto enviado ao servidor (`markedText`) leva `[[imagem pN-k]]` na posição
 * dela, e o recorte JPEG (pageImages.ts) vai ao modelo de visão (etapa de visão — docs/05 §5).
 */

export interface PageImageRegion {
  /** "p12-2" = 2ª imagem útil da página 12 (ordem vertical). */
  id: string
  /** Retângulo visível na página (pontos do PDF, origem no canto superior esquerdo). */
  rect: ImageRect
}

export interface ExtractedPage {
  page: number
  text: string
  /** Texto com `[[imagem pN-k]]` no lugar de cada imagem útil (é o que vai ao servidor). */
  markedText: string
  chars: number
  images: number
  /** Imagens com conteúdo (sem ícones/marcadores) — candidatas à etapa de visão. */
  imageRegions: PageImageRegion[]
  /** Página com pouco texto e com imagem — provável escaneada / depende de OCR. */
  needsOcr: boolean
}

export interface ExtractedPdf {
  fileName: string
  sizeBytes: number
  pages: ExtractedPage[]
  fullText: string
  /** O arquivo original, para renderizar os recortes de imagem depois (nunca é enviado). */
  file: File
  /**
   * Vários PDFs na mesma importação (questões + gabarito — spec 002 US6): páginas na numeração global,
   * contínua entre os arquivos, e o papel de cada arquivo. Montado por `mergePdfs` (pdfSet.ts).
   */
  parts?: PdfPart[]
}

export interface PdfPart {
  fileName: string
  sizeBytes: number
  role: DocumentRole
  /** Papel sugerido pela leitura do arquivo (o usuário pode trocar). */
  detected: { role: DocumentRole; reason: string }
  /** 1ª página do arquivo na numeração global. */
  firstPage: number
  pageCount: number
  file: File
}

const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat])

export async function extractPdf(file: File, onProgress?: (done: number, total: number) => void): Promise<ExtractedPdf> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = getDocument({ data })
  const doc = await task.promise
  const pages: ExtractedPage[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: TextRun[] = []
      for (const item of content.items) {
        if ('str' in item) runs.push({ str: item.str, hasEOL: item.hasEOL, baseline: vp.convertToViewportPoint(item.transform[4], item.transform[5])[1] })
      }
      const text = runs.map((r) => r.str + (r.hasEOL ? '\n' : '')).join('')
      const ops = await page.getOperatorList()
      const images = ops.fnArray.filter((fn) => IMAGE_OPS.has(fn)).length
      const imageRegions = images ? usefulImageRects(findImageRects(ops.fnArray, ops.argsArray, OPS, vp.transform), vp).map((rect, k) => ({ id: imageId(i, k), rect })) : []
      const chars = text.replace(/\s/g, '').length
      pages.push({ page: i, text, markedText: imageRegions.length ? composePageText(runs, imageRegions) : text, chars, images, imageRegions, needsOcr: images > 0 && chars < 200 })
      page.cleanup()
      onProgress?.(i, doc.numPages)
    }
  } finally {
    await task.destroy()
  }
  return {
    fileName: file.name,
    sizeBytes: file.size,
    pages,
    // quadro POP-Q extraído como texto solto → linha canônica (mesma regra do servidor, shared/tables.ts)
    fullText: pages.map((p) => `\n[[página ${p.page}]]\n${popqLayoutToLine(p.text)}`).join('\n'),
    file,
  }
}
