import { getDocument } from 'pdfjs-dist'
import type { ExtractedPdf } from './pdfExtract'

/**
 * Etapa de VISÃO no navegador (spec 002 T049): renderiza o RECORTE de cada imagem útil das páginas
 * (quadro POP-Q, foto/print do enunciado, figura) em JPEG. O envio em lotes ao servidor (modelo de visão
 * gratuito) fica em importJob.ts. O PDF continua sem sair do navegador.
 *
 * Mesmos parâmetros da avaliação em Node (scripts/pdf-images-node.ts): lado maior ~1400 px
 * (escala 1,5–4×), JPEG 0,75. Medido nos PDFs de exemplo: ~40–100 KB por recorte.
 */

export const PAGE_IMAGE_RENDER = { targetSide: 1400, minScale: 1.5, maxScale: 4, quality: 0.75, pad: 4 }
const MAX_IMAGE_BASE64 = 1_500_000

export interface PageImageCrop {
  id: string
  page: number
  /** JPEG em base64 (sem `data:`). */
  base64: string
  width: number
  height: number
}

async function canvasToBase64(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Falha ao gerar JPEG')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Renderiza os recortes de todas as imagens úteis (ou só de `ids`). */
export async function renderPageImages(pdf: ExtractedPdf, opts: { ids?: string[]; onProgress?: (done: number, total: number) => void } = {}): Promise<PageImageCrop[]> {
  const wanted = pdf.pages.flatMap((p) => p.imageRegions.map((r) => ({ ...r, page: p.page }))).filter((r) => !opts.ids || opts.ids.includes(r.id))
  if (!wanted.length) return []
  const task = getDocument({ data: new Uint8Array(await pdf.file.arrayBuffer()) })
  const doc = await task.promise
  const out: PageImageCrop[] = []
  const R = PAGE_IMAGE_RENDER
  try {
    for (const img of wanted) {
      const page = await doc.getPage(img.page)
      const r = img.rect
      // escala adaptativa: quadros pequenos ganham resolução (legibilidade para o modelo)
      let scale = Math.min(R.maxScale, Math.max(R.minScale, R.targetSide / Math.max(r.w, r.h)))
      let quality = R.quality
      for (let attempt = 0; attempt < 3; attempt++) {
        const vp = page.getViewport({ scale })
        const x = Math.max(0, Math.floor((r.x - R.pad) * scale))
        const y = Math.max(0, Math.floor((r.y - R.pad) * scale))
        const w = Math.min(Math.ceil(vp.width) - x, Math.ceil((r.w + 2 * R.pad) * scale))
        const h = Math.min(Math.ceil(vp.height) - y, Math.ceil((r.h + 2 * R.pad) * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        // só a região da imagem: a página é transladada para o recorte cair no canvas
        await page.render({ canvas, canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x, -y] }).promise
        const base64 = await canvasToBase64(canvas, quality)
        canvas.width = canvas.height = 0 // libera memória (Safari/iOS)
        if (base64.length <= MAX_IMAGE_BASE64 || attempt === 2) {
          if (base64.length <= MAX_IMAGE_BASE64) out.push({ id: img.id, page: img.page, base64, width: w, height: h })
          break
        }
        scale *= 0.7 // grande demais: reduz e tenta de novo
        quality = 0.65
      }
      page.cleanup()
      opts.onProgress?.(out.length, wanted.length)
    }
  } finally {
    await task.destroy()
  }
  return out
}
