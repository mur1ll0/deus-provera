import { getDocument } from 'pdfjs-dist'
import { apiFetch } from '@/lib/api'
import type { ExtractedPdf } from './pdfExtract'

/**
 * Etapa de VISÃO no navegador (spec 002 T049): renderiza o RECORTE de cada imagem útil das páginas
 * (quadro POP-Q, foto/print do enunciado, figura) em JPEG e envia em lotes ao servidor, que chama o
 * modelo de visão gratuito e devolve a transcrição. O PDF continua sem sair do navegador.
 *
 * Mesmos parâmetros da avaliação em Node (scripts/pdf-images-node.ts): lado maior ~1400 px
 * (escala 1,5–4×), JPEG 0,75. Medido nos PDFs de exemplo: ~40–100 KB por recorte.
 */

export const PAGE_IMAGE_RENDER = { targetSide: 1400, minScale: 1.5, maxScale: 4, quality: 0.75, pad: 4 }
/** Igual ao servidor (server/ai/pipelines/vision.ts): ≤ 3 imagens e ≤ 4 MB de base64 por requisição. */
export const VISION_BATCH = 3
export const MAX_BATCH_BASE64 = 4_000_000
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

/** Lotes de até VISION_BATCH recortes e MAX_BATCH_BASE64 (o corpo da requisição fica < 4,5 MB). */
export function batchPageImages(crops: PageImageCrop[]): PageImageCrop[][] {
  const out: PageImageCrop[][] = []
  let cur: PageImageCrop[] = []
  let size = 0
  for (const c of crops) {
    if (cur.length && (cur.length >= VISION_BATCH || size + c.base64.length > MAX_BATCH_BASE64)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(c)
    size += c.base64.length
  }
  if (cur.length) out.push(cur)
  return out
}

/** Payload de criação do job (`POST /api/imports`, source "pdf_ia"): texto com marcadores + manifesto das imagens. */
export function pdfJobPayload(pdf: ExtractedPdf, opts: { generateDistractors?: boolean; vision?: boolean } = {}) {
  return {
    source: 'pdf_ia' as const,
    fileName: pdf.fileName,
    generateDistractors: !!opts.generateDistractors,
    pages: pdf.pages.map((p) => ({ page: p.page, text: (opts.vision === false ? p.text : p.markedText).slice(0, 60_000) })),
    images: opts.vision === false ? [] : pdf.pages.flatMap((p) => p.imageRegions.map((r) => ({ id: r.id, page: p.page }))),
  }
}

export interface UploadResult {
  ok: number
  failed: number
  /** Parou por cota (HTTP 429): o restante segue como "[Imagem p. N]" ou pode ser reenviado depois. */
  quotaExceeded: boolean
  warnings: string[]
}

/**
 * Envia os recortes em sequência para `POST /api/imports/:id/images` (antes do loop de `/run`).
 * Cada lote = 1 requisição de IA no orçamento diário.
 */
export async function uploadPageImages(jobId: string, crops: PageImageCrop[], onBatch?: (done: number, total: number) => void): Promise<UploadResult> {
  const batches = batchPageImages(crops)
  const res: UploadResult = { ok: 0, failed: 0, quotaExceeded: false, warnings: [] }
  // 2ª tentativa: o servidor marca `retry` nas imagens que falharam pela 1ª vez → vão para o fim da fila, sozinhas
  const retry = (crop: PageImageCrop) => batches.push([crop])
  for (let i = 0; i < batches.length; i++) {
    const r = await apiFetch(`/api/imports/${encodeURIComponent(jobId)}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: batches[i].map((c) => ({ id: c.id, data: c.base64 })) }),
    })
    if (r.status === 429) {
      res.quotaExceeded = true
      break
    }
    if (!r.ok) {
      res.failed += batches[i].length
      res.warnings.push(`Lote ${i + 1}: HTTP ${r.status}`)
      continue
    }
    const body = (await r.json()) as { results: { id: string; status: string; retry?: boolean }[]; warnings: string[] }
    res.ok += body.results.filter((x) => x.status === 'ok').length
    for (const x of body.results.filter((y) => y.status !== 'ok')) {
      const crop = batches[i].find((c) => c.id === x.id)
      if (x.retry && crop) retry(crop)
      else res.failed++
    }
    res.warnings.push(...body.warnings)
    onBatch?.(i + 1, batches.length)
  }
  return res
}
