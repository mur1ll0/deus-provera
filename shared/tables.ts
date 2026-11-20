/**
 * Tabelas e quadros POP-Q no IMPORTADOR — tudo determinístico (custo zero de IA).
 *
 * Dentro do pipeline o POP-Q circula numa LINHA canônica, curta e fácil de copiar literalmente pela IA
 * de estruturação e de medir na avaliação (docs/10):
 *
 *     POP-Q — Aa +1; Ba +3; C -6; HG 4; CP 3; CVT 8; Ap -3; Bp -3; D -8
 *
 * 1. ANTES da segmentação, `popqLayoutToLine` converte o quadro que o pdf.js extrai como texto solto
 *    (linhas "Aa Ba C" / "+1 cm +3 cm -6 cm" / "HG CP CVT" / …) para essa linha. O quadro que vem de
 *    IMAGEM já chega nesse formato pela visão (`VISION_SYSTEM`, `recoverPopqGrids`).
 * 2. NO RASCUNHO que vai para a revisão, `tablesForDisplay` troca a linha pela grade Markdown que a tela
 *    desenha (`shared/rich-text.ts`) e as tabelas da visão (`[Imagem p. N: a | b / c | d]`) por tabelas.
 *    Formato: contrato v2, seção "Tabelas, POP-Q, gráficos e fórmulas no texto".
 */

export const POPQ_POINTS = ['Aa', 'Ba', 'C', 'HG', 'CP', 'CVT', 'Ap', 'Bp', 'D'] as const
const ALIAS: Record<string, (typeof POPQ_POINTS)[number]> = {
  aa: 'Aa', ba: 'Ba', c: 'C', hg: 'HG', gh: 'HG', cp: 'CP', pb: 'CP', cvt: 'CVT', tvl: 'CVT', ap: 'Ap', bp: 'Bp', d: 'D',
}

/** Valor de um ponto: número com sinal (vírgula ou ponto decimal), ou traço/ausente. */
const VALUE = String.raw`[+\-−–]?\s?\d+(?:[.,]\d+)?|—+-*|-{2,3}|NA|\[ilegível\]`
const normValue = (v: string) => {
  const s = v.replace(/\s+/g, '').replace(/^[−–]/, '-')
  return /^(—+-*|-{2,3})$/.test(s) ? '—' : s
}

/* ---------------------------------------------------------------- 1. layout do pdf.js → linha */

const LABEL_ROWS = [/^\s*aa\s+ba\s+c\s*$/i, /^\s*(?:hg|gh)\s+(?:cp|pb)\s+(?:cvt|tvl)\s*$/i, /^\s*ap\s+bp\s+d\s*$/i]

/** Valores de uma linha do quadro ("+1 cm +3cm -6 cm", "4 3 8", "-3 cm -3 cm —--"); null se a linha tiver outra coisa. */
function valuesRow(line: string): string[] | null {
  const s = line.replace(/(\d)\s*cm\b/gi, '$1 ').trim()
  const re = new RegExp(`^(?:(${VALUE})\\s*)+$`)
  if (!s || !re.test(s)) return null
  return [...s.matchAll(new RegExp(VALUE, 'g'))].map((m) => normValue(m[0]))
}

/**
 * Quadro POP-Q extraído como texto em 6 linhas (rótulos / valores, três vezes) → linha canônica.
 * Ponto D vazio na última linha (só 2 valores) vira "—". Qualquer outra forma fica como está.
 */
export function popqLayoutToLine(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const vals: string[] = []
    let ok = true
    for (let r = 0; r < 3 && ok; r++) {
      const labels = lines[i + 2 * r]
      const row = lines[i + 2 * r + 1] !== undefined ? valuesRow(lines[i + 2 * r + 1]) : null
      if (!labels || !LABEL_ROWS[r].test(labels) || !row) ok = false
      else if (row.length === 3 || (r === 2 && row.length === 2)) vals.push(...row, ...(row.length === 2 ? ['—'] : []))
      else ok = false
    }
    if (ok) {
      out.push(`POP-Q — ${POPQ_POINTS.map((p, k) => `${p} ${vals[k]}`).join('; ')}`)
      i += 5
    } else out.push(lines[i])
  }
  return out.join('\n')
}

/* ---------------------------------------------------------------- 2. linha → grade Markdown */

/** Pontos de uma linha "POP-Q — Aa +1; Ba +3; …" (aceita "gh/pb/tvl" e ":"/"="); null se faltar algum dos 9. */
export function parsePopqLine(body: string): Record<string, string> | null {
  const set: Record<string, string> = {}
  for (const m of body.matchAll(new RegExp(`(?:^|[^A-Za-z])(aa|ba|c|hg|gh|cp|pb|cvt|tvl|ap|bp|d)\\s*[:=]?\\s*(${VALUE})`, 'gi'))) {
    const k = ALIAS[m[1].toLowerCase()]
    if (!(k in set)) set[k] = normValue(m[2])
  }
  return POPQ_POINTS.every((p) => p in set) ? set : null
}

/** Grade POP-Q 3 × 3 em 6 linhas Markdown (rótulos em negrito), igual ao quadro do material. */
export function popqGrid(set: Record<string, string>): string {
  const rows = [POPQ_POINTS.slice(0, 3), POPQ_POINTS.slice(3, 6), POPQ_POINTS.slice(6, 9)]
  return rows.flatMap((r) => [`| ${r.map((p) => `**${p}**`).join(' | ')} |`, `| ${r.map((p) => set[p]).join(' | ')} |`]).join('\n')
}

/** Coloca `block` em linhas próprias dentro do texto (a grade só é tabela se cada linha começa e termina com "|"). */
function onOwnLines(before: string, block: string, after: string): string {
  const b = before.replace(/[ \t]+$/, '')
  const a = after.replace(/^[ \t]+/, '')
  return `${b}${b && !b.endsWith('\n') ? '\n' : ''}${block}${a && !a.startsWith('\n') ? '\n' : ''}${a}`
}

const POPQ_BRACKET = /\[Imagem p\. (\d+): (POP-?Q\s*[—–-][^\]]*)\]/gi
// termina no valor do ponto D: o segmentador junta linhas e dois quadros podem ficar na mesma linha ("Caso 01 POP-Q — … D -6 Caso 02 POP-Q — …")
const POPQ_LINE = new RegExp(String.raw`POP-?Q\s*[—–-]\s*(?=aa\b)[^\n\]]*?\bD\s*[:=]?\s*(?:${VALUE})`, 'gi')

/**
 * "[Imagem p. N: a | b / c | d]" (tabela transcrita pela visão; linhas unidas por " / " em resolveImageMarks) →
 * legenda + linhas da tabela. Linhas iniciais sem "|" são legenda (ex.: gráfico: "Gráfico de barras: Hb por mês" e
 * depois "Mês | Hb / Jan | 9,8 / …"). null se o resto não for ≥ 2 linhas com o mesmo nº (≥ 2) de células.
 */
function bracketTable(content: string): { caption: string; table: string } | null {
  const rows = content.split(/\s+\/\s+/)
  const start = rows.findIndex((r) => /\s\|\s/.test(r))
  if (start < 0) return null
  const cells = rows.slice(start).map((r) => r.split(/\s+\|\s+/).map((c) => c.trim()))
  if (cells.length < 2 || cells[0].length < 2 || cells.some((r) => r.length !== cells[0].length)) return null
  return { caption: rows.slice(0, start).join(' / ').trim(), table: cells.map((r) => `| ${r.join(' | ')} |`).join('\n') }
}

/**
 * Texto da questão para a revisão/tela: POP-Q (linha canônica, solta ou dentro de `[Imagem p. N: …]`) vira a
 * grade Markdown; tabela transcrita de imagem vira tabela Markdown. O resto do texto não muda.
 */
export function tablesForDisplay(text: string | null | undefined): string {
  if (!text) return text ?? ''
  let out = text
  // [Imagem p. N: POP-Q — …] → "[Imagem p. N: quadro POP-Q]" + grade
  out = replaceAllWith(out, POPQ_BRACKET, (m) => {
    const set = parsePopqLine(m[2])
    return set ? { block: `[Imagem p. ${m[1]}: quadro POP-Q]\n${popqGrid(set)}` } : null
  })
  // POP-Q — … numa linha do texto → "POP-Q:" + grade
  out = replaceAllWith(out, POPQ_LINE, (m) => {
    const set = parsePopqLine(m[0])
    return set ? { block: `POP-Q:\n${popqGrid(set)}` } : null
  })
  // [Imagem p. N: tabela "a | b / c | d"] → "[Imagem p. N: tabela]" + linhas
  out = replaceAllWith(out, /\[Imagem p\. (\d+): ([^\]]*\|[^\]]*)\]/g, (m) => {
    const t = bracketTable(m[2])
    return t ? { block: `[Imagem p. ${m[1]}: ${t.caption.replace(/[.:;]\s*$/, '') || 'tabela'}]\n${t.table}` } : null
  })
  return out.replace(/\n{3,}/g, '\n\n')
}

/** Troca cada casamento (re com flag g) por um BLOCO em linhas próprias; `fn` devolve null para manter o trecho. */
function replaceAllWith(text: string, re: RegExp, fn: (m: RegExpMatchArray) => { block: string } | null): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(re)) {
    const r = fn(m)
    if (!r) continue
    const start = m.index ?? 0
    out = `${onOwnLines(out + text.slice(last, start), r.block, '')}\n`
    last = start + m[0].length
  }
  if (!last) return text
  // pontuação solta logo após o quadro ("…D -8].") não vira linha sozinha
  const rest = text.slice(last).replace(/^[ \t]*[.;,]?[ \t]*\n?/, '')
  return (out + rest).replace(/\s+$/, '')
}

/* ---------------------------------------------------------------- 3. grade → linha (avaliação) */

/** Inverso da grade: cada grade POP-Q Markdown volta à linha canônica (a avaliação mede pontos nesse formato). */
export function popqGridToLine(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  const cells = (l: string | undefined) => (l && /^\s*\|.*\|\s*$/.test(l) ? l.trim().slice(1, -1).split('|').map((c) => c.replace(/\*\*/g, '').trim()) : null)
  for (let i = 0; i < lines.length; i++) {
    const set: Record<string, string> = {}
    let ok = true
    for (let r = 0; r < 3 && ok; r++) {
      const labels = cells(lines[i + 2 * r])
      const vals = cells(lines[i + 2 * r + 1])
      if (!labels || !vals || labels.length !== 3 || vals.length !== 3) ok = false
      else
        for (let k = 0; k < 3; k++) {
          const p = ALIAS[labels[k].toLowerCase()]
          if (p) set[p] = vals[k]
          else ok = false
        }
    }
    if (ok && POPQ_POINTS.every((p) => p in set)) {
      const prev = out.at(-1)
      const line = `POP-Q — ${POPQ_POINTS.map((p) => `${p} ${set[p]}`).join('; ')}`
      // "[Imagem p. N: quadro POP-Q]" / "POP-Q:" na linha de cima volta a envolver a linha
      if (prev && /\[Imagem p\. \d+: quadro POP-Q\]$/.test(prev)) out[out.length - 1] = prev.replace(/: quadro POP-Q\]$/, `: ${line}]`)
      else if (prev && /POP-?Q:\s*$/.test(prev)) out[out.length - 1] = prev.replace(/POP-?Q:\s*$/, line)
      else out.push(line)
      i += 5
    } else out.push(lines[i])
  }
  return out.join('\n')
}
