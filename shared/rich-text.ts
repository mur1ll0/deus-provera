/**
 * Texto rico MÍNIMO para enunciado, pergunta e resposta: tabelas no formato Markdown ("| a | b |")
 * dentro do texto puro. Assim tabelas, POP-Q e dados de gráficos sobrevivem à importação sem mudar
 * o contrato nem o banco (o campo continua sendo texto, legível até sem renderização).
 *
 * Só tabela e **negrito dentro da célula**: nada de HTML. A tela monta os elementos React a partir
 * destes blocos (nunca dangerouslySetInnerHTML).
 *
 *   | **Aa** | **Ba** | **C** |        ← linhas seguidas que começam e terminam com "|" = 1 tabela
 *   | +1 cm  | +3 cm  | -6 cm |
 *   |---|---|---|                       ← opcional: se vier logo após a 1ª linha, ela vira cabeçalho
 */

export interface RichCell {
  text: string
  strong: boolean
}

export type RichBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; header: RichCell[] | null; rows: RichCell[][] }

const TABLE_LINE = /^\s*\|.*\|\s*$/
const SEPARATOR_LINE = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?\s*)?\|?\s*$/

function splitCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((c) => c.trim())
}

function toCell(raw: string): RichCell {
  const m = /^\*\*(.+)\*\*$/.exec(raw)
  return m ? { text: m[1].trim(), strong: true } : { text: raw, strong: false }
}

function buildTable(lines: string[]): RichBlock {
  const hasHeader = lines.length >= 2 && SEPARATOR_LINE.test(lines[1])
  const body = lines.filter((l) => !SEPARATOR_LINE.test(l))
  const rows = body.map((l) => splitCells(l).map(toCell))
  const width = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => ({ text: '', strong: false }))])
  return hasHeader ? { kind: 'table', header: padded[0], rows: padded.slice(1) } : { kind: 'table', header: null, rows: padded }
}

/** Divide o texto em blocos de texto e tabelas. Uma linha isolada com "|" continua sendo texto. */
export function parseRichText(src: string | null | undefined): RichBlock[] {
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: RichBlock[] = []
  let text: string[] = []
  const flushText = () => {
    const t = text.join('\n').replace(/^\n+|\n+$/g, '')
    if (t.trim()) blocks.push({ kind: 'text', text: t })
    text = []
  }
  for (let i = 0; i < lines.length; ) {
    if (TABLE_LINE.test(lines[i]) && splitCells(lines[i]).length >= 2) {
      let j = i
      while (j < lines.length && TABLE_LINE.test(lines[j])) j++
      if (j - i >= 2) {
        flushText()
        blocks.push(buildTable(lines.slice(i, j)))
        i = j
        continue
      }
    }
    text.push(lines[i])
    i++
  }
  flushText()
  return blocks
}

/** true se o texto tem ao menos uma tabela (útil para testes e para decidir o layout). */
export function hasRichTable(src: string | null | undefined): boolean {
  return parseRichText(src).some((b) => b.kind === 'table')
}
