/**
 * Etapa de VISÃO em Node (avaliação/scripts): extrai o texto das páginas com os marcadores
 * `[[imagem pN-k]]` e renderiza o recorte de cada imagem em JPEG com pdf.js (build legacy) +
 * @napi-rs/canvas — o mesmo que o navegador faz em src/features/import/pageImages.ts.
 * Lógica de posição/recorte compartilhada: shared/page-images.ts.
 */
import { createCanvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { composePageText, findImageRects, imageId, usefulImageRects, type ImageRect, type TextRun } from '../shared/page-images'

export interface PdfPageWithImages {
  page: number
  /** Texto da página com `[[imagem pN-k]]` na posição de cada imagem útil. */
  text: string
  /** Texto sem marcadores (idêntico à extração antiga). */
  plainText: string
  images: { id: string; rect: ImageRect }[]
}

export interface PageImageJpeg {
  id: string
  page: number
  /** JPEG em base64 (sem prefixo data:). */
  base64: string
  width: number
  height: number
  bytes: number
}

/** Mesmos parâmetros do navegador: lado maior ~1400 px, escala 1,5–4×, JPEG 0,75. */
export const RENDER = { targetSide: 1400, minScale: 1.5, maxScale: 4, quality: 75, pad: 4 }

export async function openPdfWithImages(path: string) {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), disableFontFace: true, verbosity: 0 })
  const doc = await task.promise
  const pages: PdfPageWithImages[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const ops = await page.getOperatorList()
    const rects = usefulImageRects(findImageRects(ops.fnArray, ops.argsArray, OPS, vp.transform), vp)
    const images = rects.map((rect, k) => ({ id: imageId(i, k), rect }))
    const tc = await page.getTextContent()
    const runs: TextRun[] = []
    for (const it of tc.items) {
      if (!('str' in it)) continue
      runs.push({ str: it.str, hasEOL: it.hasEOL, baseline: vp.convertToViewportPoint(it.transform[4], it.transform[5])[1] })
    }
    const plainText = runs.map((r) => r.str + (r.hasEOL ? '\n' : '')).join('')
    pages.push({ page: i, text: composePageText(runs, images), plainText, images })
  }

  /** Renderiza o recorte de uma imagem (só a região, não a página inteira). */
  async function renderImage(pageNum: number, id: string): Promise<PageImageJpeg> {
    const p = pages[pageNum - 1]
    const img = p.images.find((x) => x.id === id)
    if (!img) throw new Error(`imagem ${id} não encontrada`)
    const page = await doc.getPage(pageNum)
    const r = img.rect
    const scale = Math.min(RENDER.maxScale, Math.max(RENDER.minScale, RENDER.targetSide / Math.max(r.w, r.h)))
    const vp = page.getViewport({ scale })
    const x = Math.max(0, Math.floor((r.x - RENDER.pad) * scale))
    const y = Math.max(0, Math.floor((r.y - RENDER.pad) * scale))
    const w = Math.min(Math.ceil(vp.width) - x, Math.ceil((r.w + 2 * RENDER.pad) * scale))
    const h = Math.min(Math.ceil(vp.height) - y, Math.ceil((r.h + 2 * RENDER.pad) * scale))
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    // translada a página para que só o recorte caia dentro do canvas
    // (os tipos do pdf.js são do DOM; o @napi-rs/canvas implementa a mesma API 2D)
    const params = { canvas, canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x, -y] } as unknown as Parameters<typeof page.render>[0]
    await page.render(params).promise
    const buf = await canvas.encode('jpeg', RENDER.quality)
    page.cleanup()
    return { id, page: pageNum, base64: buf.toString('base64'), width: w, height: h, bytes: buf.length }
  }

  return { pages, renderImage, destroy: () => task.destroy() }
}
