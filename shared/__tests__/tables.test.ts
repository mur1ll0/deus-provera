import { describe, expect, it } from 'vitest'
import { parseRichText } from '../rich-text'
import { parsePopqLine, popqGridToLine, popqLayoutToLine, tablesForDisplay } from '../tables'

// Como o pdf.js extrai o quadro da Questão 01 do PDF de OSCE (texto, não imagem)
const OSCE_Q01 = [
  'Exame físico: uretra hipermóvel ao teste de Q-tip (>30º). POP-Q com Aa em +1 cm.',
  'Aa Ba C',
  '+1 cm +3 cm -6 cm',
  'HG CP CVT',
  '4 3 8',
  'Ap Bp D',
  '-3 cm -3 cm -8',
  'Parte 2:',
].join('\n')

const LINE = 'POP-Q — Aa +1; Ba +3; C -6; HG 4; CP 3; CVT 8; Ap -3; Bp -3; D -8'

describe('popqLayoutToLine (quadro em texto → linha canônica)', () => {
  it('converte as 6 linhas do pdf.js e mantém o resto', () => {
    expect(popqLayoutToLine(OSCE_Q01)).toBe(
      ['Exame físico: uretra hipermóvel ao teste de Q-tip (>30º). POP-Q com Aa em +1 cm.', LINE, 'Parte 2:'].join('\n'),
    )
  })

  it('aceita "+3cm" sem espaço, D com traço ("—--") ou ausente, e aliases gh/pb/tvl', () => {
    const t = ['Aa Ba C', '+2 cm +3cm +6 cm', 'gh pb tvl', '5 3 6', 'Ap Bp D', '+2 cm +2 cm —--'].join('\n')
    expect(popqLayoutToLine(t)).toBe('POP-Q — Aa +2; Ba +3; C +6; HG 5; CP 3; CVT 6; Ap +2; Bp +2; D —')
    const semD = ['Aa Ba C', '+1 +3 0', 'HG CP CVT', '4 3 6', 'Ap Bp D', '+2 +2'].join('\n')
    expect(popqLayoutToLine(semD)).toMatch(/D —$/)
  })

  it('não mexe em texto parecido que não é o quadro completo', () => {
    const t = 'Aa Ba C\n+1 cm +3 cm\nHG CP CVT\n4 3 8'
    expect(popqLayoutToLine(t)).toBe(t)
  })
})

describe('tablesForDisplay (rascunho → grade Markdown)', () => {
  it('linha POP-Q vira "POP-Q:" + grade 3 × 3 em 6 linhas, que a tela desenha como tabela', () => {
    const out = tablesForDisplay(`Exame físico. ${LINE}\nQual o estágio?`)
    expect(out).toBe(
      [
        'Exame físico.',
        'POP-Q:',
        '| **Aa** | **Ba** | **C** |',
        '| +1 | +3 | -6 |',
        '| **HG** | **CP** | **CVT** |',
        '| 4 | 3 | 8 |',
        '| **Ap** | **Bp** | **D** |',
        '| -3 | -3 | -8 |',
        'Qual o estágio?',
      ].join('\n'),
    )
    expect(parseRichText(out).map((b) => b.kind)).toEqual(['text', 'table', 'text'])
  })

  it('dois quadros na mesma linha (o segmentador junta linhas) viram duas grades, sem perder o 2º caso', () => {
    const out = tablesForDisplay(
      'Estadiamento POP-Q Caso 01 POP-Q — Aa +2; Ba +3; C +2; HG 4; CP 3; CVT 6; Ap -3; Bp -3; D -6 Caso 02 POP-Q — Aa -3; Ba -3; C +4; HG 4; CP 3; CVT 6; Ap +2; Bp +4; D 0 Parte 2:',
    )
    const blocks = parseRichText(out)
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text', 'table', 'text'])
    expect(out).toContain('Caso 02\nPOP-Q:')
    expect(out).toContain('| +2 | +4 | 0 |')
    expect(out.endsWith('Parte 2:')).toBe(true)
  })

  it('quadro POP-Q vindo da visão ("[Imagem p. N: POP-Q — …]") mantém o marcador da imagem', () => {
    const out = tablesForDisplay(`Paciente com prolapso: [Imagem p. 7: POP-Q — Aa +2; Ba +1; C -5; HG 3,5; CP 2; CVT 8; Ap -3; Bp -3; D —]. Responda.`)
    expect(out.split('\n').slice(0, 3)).toEqual(['Paciente com prolapso:', '[Imagem p. 7: quadro POP-Q]', '| **Aa** | **Ba** | **C** |'])
    expect(out).toContain('| 3,5 | 2 | 8 |')
    expect(out.endsWith('| -3 | -3 | — |\nResponda.')).toBe(true)
  })

  it('tabela transcrita pela visão ("a | b / c | d") vira tabela; figura e POP-Q incompleto ficam como estão', () => {
    expect(tablesForDisplay('[Imagem p. 2: Exame | Valor / Hb | 9,8 / Ferritina | 8]')).toBe(
      '[Imagem p. 2: tabela]\n| Exame | Valor |\n| Hb | 9,8 |\n| Ferritina | 8 |',
    )
    // gráfico: legenda + valores lidos
    expect(tablesForDisplay('[Imagem p. 5: Gráfico de linhas: Hb (g/dL) por mês / Mês | Hb / Jan | 9,8 / Fev | aprox. 10,5]')).toBe(
      '[Imagem p. 5: Gráfico de linhas: Hb (g/dL) por mês]\n| Mês | Hb |\n| Jan | 9,8 |\n| Fev | aprox. 10,5 |',
    )
    const fig = '[Imagem p. 3: colposcopia com epitélio acetobranco]'
    expect(tablesForDisplay(fig)).toBe(fig)
    const incompleto = 'POP-Q — Aa +1; Ba +3; C -6'
    expect(tablesForDisplay(incompleto)).toBe(incompleto)
    expect(tablesForDisplay(null)).toBe('')
  })

  it('a avaliação lê a grade de volta (ida e volta sem perder pontos)', () => {
    const shown = tablesForDisplay(`Caso 1. ${LINE}\nCaso 2. [Imagem p. 9: POP-Q — Aa -3; Ba -3; C +4; HG 4; CP 3; CVT 6; Ap +2; Bp +4; D 0]`)
    const back = popqGridToLine(shown)
    expect(back).toContain(LINE)
    expect(back).toContain('[Imagem p. 9: POP-Q — Aa -3; Ba -3; C +4; HG 4; CP 3; CVT 6; Ap +2; Bp +4; D 0]')
    expect(parsePopqLine(back.split('\n')[1])).toMatchObject({ Aa: '+1', D: '-8' })
  })
})
