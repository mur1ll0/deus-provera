import { describe, expect, it } from 'vitest'
import { hasRichTable, parseRichText } from '../rich-text'

const POPQ = [
  'Exame físico: POP-Q:',
  '| **Aa** | **Ba** | **C** |',
  '| +1 cm | +3 cm | -6 cm |',
  '| **HG** | **CP** | **CVT** |',
  '| 4 | 3 | 8 |',
  '| **Ap** | **Bp** | **D** |',
  '| -3 cm | -3 cm | -8 cm |',
  'Parte 2: quais exames?',
].join('\n')

describe('parseRichText', () => {
  it('texto sem tabela vira um bloco só, preservando quebras de linha', () => {
    expect(parseRichText('Linha 1\nLinha 2')).toEqual([{ kind: 'text', text: 'Linha 1\nLinha 2' }])
    expect(parseRichText('')).toEqual([])
    expect(parseRichText(null)).toEqual([])
  })

  it('POP-Q em grade 3 × 6 sem cabeçalho, com rótulos em negrito', () => {
    const blocks = parseRichText(POPQ)
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text'])
    const t = blocks[1]
    if (t.kind !== 'table') throw new Error('esperava tabela')
    expect(t.header).toBeNull()
    expect(t.rows).toHaveLength(6)
    expect(t.rows[0]).toEqual([
      { text: 'Aa', strong: true },
      { text: 'Ba', strong: true },
      { text: 'C', strong: true },
    ])
    expect(t.rows[5][2]).toEqual({ text: '-8 cm', strong: false })
  })

  it('tabela Markdown com separador usa a 1ª linha como cabeçalho e completa células faltantes', () => {
    const blocks = parseRichText('| Exame | Valor |\n|---|:---:|\n| Hb | 9,8 g/dL |\n| Ferritina |')
    expect(blocks).toEqual([
      {
        kind: 'table',
        header: [
          { text: 'Exame', strong: false },
          { text: 'Valor', strong: false },
        ],
        rows: [
          [
            { text: 'Hb', strong: false },
            { text: '9,8 g/dL', strong: false },
          ],
          [
            { text: 'Ferritina', strong: false },
            { text: '', strong: false },
          ],
        ],
      },
    ])
  })

  it('linha isolada com barras continua texto (ex.: "PA 120/80 | FC 80")', () => {
    expect(hasRichTable('| PA 120/80 | FC 80 |')).toBe(false)
    expect(hasRichTable('PA 120/80 | FC 80\nsem tabela')).toBe(false)
    expect(hasRichTable(POPQ)).toBe(true)
  })

  it('não interpreta HTML: o conteúdo da célula é texto', () => {
    const blocks = parseRichText('| <b>x</b> | y |\n| 1 | 2 |')
    expect(blocks[0]).toMatchObject({ kind: 'table', rows: [[{ text: '<b>x</b>' }, { text: 'y' }], expect.anything()] })
  })
})
