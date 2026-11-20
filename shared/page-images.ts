/**
 * Imagens das páginas do PDF (etapa de VISÃO do importador) — funções puras, usadas no navegador
 * (src/features/import/pageImages.ts), na avaliação em Node (scripts/pdf-images-node.ts) e no servidor.
 *
 * Fluxo:
 *  1. `findImageRects` percorre a lista de operadores do pdf.js (save/restore/transform/paintImage…) e
 *     devolve o retângulo de cada imagem na página (coordenadas do viewport, y para baixo).
 *  2. `composePageText` monta o texto da página como antes e insere `[[imagem pN-k]]` na posição
 *     vertical da imagem (depois da última linha de texto acima do centro dela).
 *  3. O recorte da imagem vai ao modelo de visão; `resolveImageMarks` troca o marcador por
 *     `[Imagem p. N: transcrição]` ANTES da segmentação — assim o segmentador e a IA de estruturação
 *     enxergam o quadro POP-Q / o enunciado fotografado dentro da questão certa.
 *
 * Sem pdf.js aqui: os ids dos operadores (`OPS`) e a matriz do viewport são passados por quem chama.
 */

export interface ImageRect {
  x: number
  y: number
  w: number
  h: number
}

export type Matrix = [number, number, number, number, number, number]

/** Subconjunto de `OPS` do pdf.js usado para rastrear a matriz de transformação (CTM). */
export interface OpsIds {
  save: number
  restore: number
  transform: number
  paintFormXObjectBegin: number
  paintFormXObjectEnd: number
  paintImageXObject: number
  paintInlineImageXObject: number
  paintImageXObjectRepeat: number
  clip: number
  eoClip: number
  constructPath: number
}

/** m1 × m2 (mesma semântica de `Util.transform` do pdf.js: aplica m2 primeiro). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
}

/** Caixa alinhada aos eixos do retângulo [x0, y0, x1, y1] sob a matriz `m`. */
function boxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number): ImageRect {
  const pts = [applyMatrix(m, x0, y0), applyMatrix(m, x1, y0), applyMatrix(m, x0, y1), applyMatrix(m, x1, y1)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function intersect(a: ImageRect, b: ImageRect | null): ImageRect {
  if (!b) return a
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }
}

const isMatrix = (v: unknown): v is Matrix => Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number')

/**
 * Retângulos VISÍVEIS das imagens desenhadas na página, em coordenadas do viewport cuja matriz é
 * `viewportTransform` (use `page.getViewport({ scale: 1 }).transform`).
 *
 * Toda imagem é desenhada no quadrado unitário sob a matriz atual (CTM). Editores como o Google Docs
 * cortam fotos com um caminho de recorte (`re W n` → `eoClip` + `constructPath`), então o retângulo
 * da imagem é intersectado com o recorte vigente — sem isso o recorte "vaza" para a questão vizinha.
 */
export function findImageRects(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: OpsIds, viewportTransform: number[]): ImageRect[] {
  type GState = { ctm: Matrix; clip: ImageRect | null }
  let g: GState = { ctm: viewportTransform.slice(0, 6) as Matrix, clip: null }
  const stack: GState[] = []
  const rects: ImageRect[] = []
  let pendingClip = false
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i] as unknown[] | null
    if (fn === ops.save) stack.push(g)
    else if (fn === ops.restore) g = stack.pop() ?? g
    else if (fn === ops.transform && args && args.length >= 6) g = { ...g, ctm: multiply(g.ctm, args.slice(0, 6) as Matrix) }
    else if (fn === ops.clip || fn === ops.eoClip) pendingClip = true
    else if (fn === ops.constructPath) {
      // args: [opDePintura, [dados], minMax = [x0, y0, x1, y1] no espaço do usuário] (pdf.js ≥ 5)
      const mm = args?.[2] as ArrayLike<number> | null | undefined
      if (pendingClip && mm && mm.length >= 4) g = { ...g, clip: intersect(boxOf(g.ctm, mm[0], mm[1], mm[2], mm[3]), g.clip) }
      pendingClip = false
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(g)
      if (args && isMatrix(args[0])) g = { ...g, ctm: multiply(g.ctm, args[0]) }
    } else if (fn === ops.paintFormXObjectEnd) g = stack.pop() ?? g
    else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) rects.push(intersect(boxOf(g.ctm, 0, 0, 1, 1), g.clip))
    else if (fn === ops.paintImageXObjectRepeat && args) {
      // args: [objId, scaleX, scaleY, positions[x0, y0, x1, y1, …]]
      const [, sx, sy, positions] = args as [unknown, number, number, ArrayLike<number>]
      for (let k = 0; k + 1 < (positions?.length ?? 0); k += 2) rects.push(intersect(boxOf(multiply(g.ctm, [sx, 0, 0, sy, positions[k], positions[k + 1]]), 0, 0, 1, 1), g.clip))
    }
  }
  return rects
}

/**
 * Descarta imagens que não carregam conteúdo (ícones, marcadores, linhas, logotipos minúsculos),
 * recorta à página e remove duplicatas (mesma imagem desenhada duas vezes).
 * Limiares em pontos do PDF (escala 1): lado mínimo 36 pt (~1,3 cm) e área ≥ 0,8% da página
 * (uma foto clínica de 2,7 × 2,8 cm numa A4 tem ~1,2% e precisa passar).
 */
export function usefulImageRects(rects: ImageRect[], page: { width: number; height: number }, minSide = 36, minAreaRatio = 0.008): ImageRect[] {
  const out: ImageRect[] = []
  for (const r of rects) {
    const x = Math.max(0, r.x)
    const y = Math.max(0, r.y)
    const w = Math.min(page.width, r.x + r.w) - x
    const h = Math.min(page.height, r.y + r.h) - y
    if (w < minSide || h < minSide || (w * h) / (page.width * page.height) < minAreaRatio) continue
    const clipped = { x, y, w, h }
    if (out.some((o) => overlapRatio(o, clipped) > 0.9)) continue
    out.push(clipped)
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

function overlapRatio(a: ImageRect, b: ImageRect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h)
}

/* ------------------------------ marcadores no texto ------------------------------ */

/** Id estável da imagem: página + ordem vertical na página ("p12-2"). */
export const imageId = (page: number, index: number) => `p${page}-${index + 1}`
export const imageMark = (id: string) => `[[imagem ${id}]]`
export const IMAGE_MARK_RE = /\[\[imagem (p\d+-\d+)\]\]/g

export interface TextRun {
  str: string
  hasEOL: boolean
  /** Linha de base do texto no viewport (y para baixo, mesma escala dos retângulos). */
  baseline: number
}

/**
 * Texto da página igual ao da extração simples (`str + (hasEOL ? '\n' : '')`), com o marcador de
 * cada imagem inserido depois da última linha (na ordem do PDF) cuja base está acima do centro da imagem.
 * Sem imagens, o resultado é idêntico ao texto sem marcadores (as métricas de texto não mudam).
 */
export function composePageText(runs: TextRun[], images: { id: string; rect: ImageRect }[]): string {
  const after = new Map<number, string[]>() // índice do run → ids inseridos depois dele (-1 = início)
  for (const img of images) {
    const cy = img.rect.y + img.rect.h / 2
    let at = -1
    runs.forEach((r, i) => {
      if (r.str.trim() && r.baseline < cy) at = i
    })
    after.set(at, [...(after.get(at) ?? []), img.id])
  }
  let text = ''
  const put = (ids: string[] | undefined) => {
    for (const id of ids ?? []) text += `${text && !text.endsWith('\n') ? '\n' : ''}${imageMark(id)}\n`
  }
  put(after.get(-1))
  runs.forEach((r, i) => {
    text += r.str + (r.hasEOL ? '\n' : '')
    put(after.get(i))
  })
  return text
}

export type ImageKind = 'texto' | 'pop_q' | 'tabela' | 'figura' | 'decorativa'

export interface ImageNote {
  page: number
  /** Transcrição/descrição do modelo de visão; vazio/`null` = não transcrita (sem IA, falha ou não enviada). */
  text?: string | null
  kind?: ImageKind
}

/** Abre/fecha o texto de uma foto/print transcrito (o conteúdo vira texto normal da questão). */
export const imageTextOpen = (page: number) => `[Imagem p. ${page} — texto da imagem:]`
export const imageTextClose = (page: number) => `[Imagem p. ${page} — fim]`

/**
 * Troca `[[imagem pN-k]]` pela transcrição, ANTES da segmentação:
 *  - foto/print de texto → `[Imagem p. N — texto da imagem:]` + texto (linhas normais) + `[Imagem p. N — fim]`
 *    (o segmentador e a IA enxergam "QUESTÃO 4", "a)"… como se fossem texto do PDF);
 *  - POP-Q, tabela, figura → `[Imagem p. N: transcrição]` numa linha, dentro da questão;
 *  - não transcrita → `[Imagem p. N]` (o leitor e a IA sabem que ali havia uma imagem);
 *  - decorativa → some.
 * Só ids conhecidos e só a 1ª ocorrência de cada um: um `[[imagem …]]` forjado no texto do PDF é removido.
 */
export function resolveImageMarks(text: string, notes: Record<string, ImageNote | undefined>): string {
  const used = new Set<string>()
  return text.replace(IMAGE_MARK_RE, (_, id: string) => {
    const n = notes[id]
    if (!n || used.has(id)) return ''
    used.add(id)
    if (n.kind === 'decorativa') return ''
    const body = (n.text ?? '').replace(/\[(?=Imagem)/gi, '(').trim()
    if (!body) return `[Imagem p. ${n.page}]`
    if (n.kind === 'texto') return `${imageTextOpen(n.page)}\n${body}\n${imageTextClose(n.page)}`
    return `[Imagem p. ${n.page}: ${body.replace(/\]/g, ')').replace(/\s*\n\s*/g, ' / ')}]`
  })
}

/**
 * Modelos de visão costumam devolver o texto de uma foto numa linha só. Recoloca quebras antes dos
 * padrões que o segmentador usa: "QUESTÃO N", afirmativas "( )", subitens "a)"/"b." e "Resposta:".
 */
export function reflowTranscription(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+(?=QUEST[ÃA]O\s*\d)/gi, '\n')
    .replace(/[ \t]+(?=\(\s*[VF]?\s*\)\s)/g, '\n')
    .replace(/([.?!:;])[ \t]+(?=[a-hA-H][.)]\s)/g, '$1\n')
    .replace(/([.?!:;])[ \t]+(?=(?:Resposta|Gabarito|R)\s*:)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Ids dos marcadores presentes num texto (ordem de aparição, sem repetição). */
export function imageIdsIn(text: string): string[] {
  return [...new Set([...text.matchAll(IMAGE_MARK_RE)].map((m) => m[1]))]
}

/** Texto completo para o segmentador: `[[página N]]` + texto da página com as imagens resolvidas. */
export function fullTextWithImages(pages: { page: number; text: string }[], notes: Record<string, ImageNote | undefined> = {}): string {
  return pages.map((p) => `\n[[página ${p.page}]]\n${resolveImageMarks(p.text, notes)}`).join('\n')
}

/** Transcrições (não decorativas) presentes num trecho já resolvido — vira `descricao_imagem` da questão. */
export function imageDescriptionsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\[Imagem p\. (\d+)(?:: ([^\]]*)\]| — texto da imagem:\]\n([\s\S]*?)\n\[Imagem p\. \d+ — fim\]|\])/g)) {
    const body = (m[2] ?? m[3] ?? '').trim()
    out.push(body ? `p. ${m[1]}: ${body}` : `p. ${m[1]}: imagem não transcrita`)
  }
  return out
}
