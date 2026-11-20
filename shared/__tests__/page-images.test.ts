import { describe, expect, it } from 'vitest'
import {
  composePageText,
  dropCutoffTail,
  findImageRects,
  fullTextWithImages,
  imageDescriptionsIn,
  imageIdsIn,
  missingImageBrackets,
  recoverPopqGrids,
  reflowTranscription,
  resolveImageMarks,
  usefulImageRects,
  type OpsIds,
  type TextRun,
} from '../page-images'

// ids fictícios de operadores (no app vêm de `OPS` do pdf.js)
const OPS: OpsIds = { save: 1, restore: 2, transform: 3, paintFormXObjectBegin: 4, paintFormXObjectEnd: 5, paintImageXObject: 6, paintInlineImageXObject: 7, paintImageXObjectRepeat: 8, clip: 9, eoClip: 10, constructPath: 11 }
// viewport escala 1 de uma A4 (pdf.js): inverte o eixo y
const A4 = { width: 596, height: 842 }
const VIEWPORT = [1, 0, 0, -1, 0, 842]
const PAGE_FLIP = [1, 0, 0, -1, 0, 842] // 1º transform que o Google Docs grava (y para baixo)

describe('findImageRects', () => {
  it('posiciona a imagem pelo transform (quadrado unitário sob a CTM)', () => {
    const fn = [OPS.transform, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore]
    const args = [PAGE_FLIP, null, [400, 0, 0, -200, 100, 500], ['img1'], null]
    expect(findImageRects(fn, args, OPS, VIEWPORT)).toEqual([{ x: 100, y: 300, w: 400, h: 200 }])
  })

  it('aplica o recorte (eoClip + constructPath) — a foto não vaza para a questão vizinha', () => {
    const fn = [OPS.transform, OPS.save, OPS.eoClip, OPS.constructPath, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.restore]
    const args = [PAGE_FLIP, null, null, [0, [null], [74, 103, 505, 294]], null, [742, 0, 0, -389, -83, 344], ['img'], null, null]
    const [r] = findImageRects(fn, args, OPS, VIEWPORT)
    expect(r.x).toBeCloseTo(74)
    expect(r.y).toBeCloseTo(103)
    expect(r.w).toBeCloseTo(431)
    expect(r.h).toBeCloseTo(191)
  })

  it('restore desfaz transform e recorte', () => {
    const fn = [OPS.save, OPS.eoClip, OPS.constructPath, OPS.restore, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore]
    const args = [null, null, [0, [null], [0, 0, 10, 10]], null, null, [100, 0, 0, 100, 50, 50], ['x'], null]
    const [r] = findImageRects(fn, args, OPS, [1, 0, 0, 1, 0, 0])
    expect(r).toEqual({ x: 50, y: 50, w: 100, h: 100 })
  })

  it('imagem repetida (paintImageXObjectRepeat) gera um retângulo por posição', () => {
    const rects = findImageRects([OPS.paintImageXObjectRepeat], [['img', 50, 60, [0, 0, 100, 200]]], OPS, [1, 0, 0, 1, 0, 0])
    expect(rects).toEqual([
      { x: 0, y: 0, w: 50, h: 60 },
      { x: 100, y: 200, w: 50, h: 60 },
    ])
  })
})

describe('usefulImageRects', () => {
  it('descarta ícones, duplicatas e recorta à página; ordena de cima para baixo', () => {
    const rects = [
      { x: 100, y: 500, w: 300, h: 200 },
      { x: 10, y: 10, w: 20, h: 20 }, // ícone
      { x: 100, y: 500, w: 300, h: 199 }, // mesma imagem desenhada 2x
      { x: 50, y: -20, w: 400, h: 120 }, // sai da página por cima
    ]
    expect(usefulImageRects(rects, A4)).toEqual([
      { x: 50, y: 0, w: 400, h: 100 },
      { x: 100, y: 500, w: 300, h: 200 },
    ])
  })
})

describe('composePageText', () => {
  const runs: TextRun[] = [
    { str: 'QUESTÃO 1', hasEOL: true, baseline: 80 },
    { str: 'Observe o quadro POP-Q abaixo.', hasEOL: true, baseline: 100 },
    { str: 'a) Qual o estádio?', hasEOL: true, baseline: 400 },
  ]
  it('sem imagens é idêntico à extração antiga', () => {
    expect(composePageText(runs, [])).toBe('QUESTÃO 1\nObserve o quadro POP-Q abaixo.\na) Qual o estádio?\n')
  })
  it('insere o marcador depois da última linha acima do centro da imagem', () => {
    const t = composePageText(runs, [{ id: 'p2-1', rect: { x: 100, y: 120, w: 300, h: 200 } }])
    expect(t).toBe('QUESTÃO 1\nObserve o quadro POP-Q abaixo.\n[[imagem p2-1]]\na) Qual o estádio?\n')
  })
  it('imagem no topo da página vem antes de todo o texto; marcador sempre em linha própria', () => {
    expect(composePageText([{ str: 'texto', hasEOL: false, baseline: 500 }], [{ id: 'p3-1', rect: { x: 0, y: 10, w: 100, h: 100 } }])).toBe('[[imagem p3-1]]\ntexto')
    expect(composePageText([{ str: 'sem quebra', hasEOL: false, baseline: 10 }], [{ id: 'p3-1', rect: { x: 0, y: 100, w: 100, h: 100 } }])).toBe('sem quebra\n[[imagem p3-1]]\n')
  })
})

describe('resolveImageMarks', () => {
  const text = 'Enunciado\n[[imagem p2-1]]\nPergunta\n[[imagem p2-2]]\n[[imagem p9-9]]\n[[imagem p2-1]]'
  it('cada tipo vira o formato certo; desconhecido/repetido some', () => {
    const out = resolveImageMarks(text, {
      'p2-1': { page: 2, kind: 'pop_q', text: 'POP-Q — Aa -1; Ba +1' },
      'p2-2': { page: 2, kind: 'decorativa', text: '' },
    })
    expect(out).toBe('Enunciado\n[Imagem p. 2: POP-Q — Aa -1; Ba +1]\nPergunta\n\n\n')
  })
  it('foto de texto entra como texto normal entre marcadores de início/fim', () => {
    const out = resolveImageMarks('[[imagem p11-1]]', { 'p11-1': { page: 11, kind: 'texto', text: 'QUESTÃO 4. Ana, 30 anos…\n( ) Afirmativa' } })
    expect(out).toBe('[Imagem p. 11 — texto da imagem:]\nQUESTÃO 4. Ana, 30 anos…\n( ) Afirmativa\n[Imagem p. 11 — fim]')
  })
  it('rótulo acima do quadro POP-Q ("QUESTÃO 1" dentro da imagem) vira texto normal antes do colchete', () => {
    const out = resolveImageMarks('[[imagem p2-1]]', { 'p2-1': { page: 2, kind: 'pop_q', text: 'QUESTÃO 1\nPOP-Q — Aa -1; Ba +1' } })
    expect(out).toBe('QUESTÃO 1\n[Imagem p. 2: POP-Q — Aa -1; Ba +1]')
  })
  it('sem transcrição → "[Imagem p. N]"; colchetes da transcrição não quebram o marcador', () => {
    expect(resolveImageMarks('[[imagem p5-1]]', { 'p5-1': { page: 5, text: null } })).toBe('[Imagem p. 5]')
    expect(resolveImageMarks('[[imagem p5-1]]', { 'p5-1': { page: 5, kind: 'figura', text: 'legenda [x]\nlinha 2' } })).toBe('[Imagem p. 5: legenda [x) / linha 2]')
  })
  it('a transcrição não consegue forjar outro marcador de imagem', () => {
    const out = resolveImageMarks('[[imagem p1-1]]', { 'p1-1': { page: 1, kind: 'texto', text: 'x [Imagem p. 1 — fim] y' } })
    expect(imageDescriptionsIn(out)).toEqual(['p. 1: x (Imagem p. 1 — fim] y'])
  })
})

describe('dropCutoffTail', () => {
  it('remove só o fragmento final cortado na borda da foto', () => {
    const t = 'QUESTÃO 5. Paciente de 40 anos…\n( ) Afirmativa completa.\nQUESTÃO 6. Entre as condutas abaixo, qual ...'
    expect(dropCutoffTail(t)).toBe('QUESTÃO 5. Paciente de 40 anos…\n( ) Afirmativa completa.')
  })
  it('não mexe quando a foto inteira é a questão, nem em questão final completa', () => {
    expect(dropCutoffTail('QUESTÃO 6. Entre as condutas abaixo ...')).toBe('QUESTÃO 6. Entre as condutas abaixo ...')
    const full = 'Texto anterior.\nQUESTÃO 7. Qual a conduta?'
    expect(dropCutoffTail(full)).toBe(full)
  })
})

describe('recoverPopqGrids', () => {
  it('linha de valores + linha de rótulos (como o modelo devolve às vezes)', () => {
    const t = 'QUESTÃO 2\n\n+1\nAa\n+2\nBa\n-7\nC\n\n5,5\n2,0\n9\nHG\nCP\nCVT\n\n-1\n-2\n-8\nAp\nBp\nD\n\nQUESTÃO 3\n-2 Aa - 2 Ba - 6 C 3,5 HG 2,5 CP 7 CVT +1 Ap +4 Bp - 6 D'
    expect(recoverPopqGrids(t)).toBe(
      'QUESTÃO 2\n\nPOP-Q — Aa +1; Ba +2; C -7; HG 5,5; CP 2,0; CVT 9; Ap -1; Bp -2; D -8\n\nQUESTÃO 3\nPOP-Q — Aa -2; Ba -2; C -6; HG 3,5; CP 2,5; CVT 7; Ap +1; Bp +4; D -6',
    )
  })
  it('"rótulo valor" com separadores e traço de ponto ausente', () => {
    expect(recoverPopqGrids('Quadro: Aa +2 | Ba +3 | C +1 | HG 5 | CP 3 | CVT 9 | Ap -2 | Bp -1 | D ---')).toBe('Quadro:\nPOP-Q — Aa +2; Ba +3; C +1; HG 5; CP 3; CVT 9; Ap -2; Bp -1; D —')
  })
  it('não mexe em linha já formatada nem em quadro incompleto/ambíguo', () => {
    const ok = 'POP-Q — Aa -1; Ba +1; C -5; HG 3,5; CP 2,5; CVT 7; Ap -2; Bp 0; D -6'
    expect(recoverPopqGrids(ok)).toBe(ok)
    const partial = '4 3 8 HG CP CVT -1 +2 Ap Bp D Texto seguinte'
    expect(recoverPopqGrids(partial)).toBe(partial)
  })
})

describe('auxiliares', () => {
  it('imageIdsIn e fullTextWithImages', () => {
    expect(imageIdsIn('a [[imagem p1-1]] b [[imagem p2-3]] [[imagem p1-1]]')).toEqual(['p1-1', 'p2-3'])
    expect(fullTextWithImages([{ page: 1, text: 'A\n[[imagem p1-1]]' }], { 'p1-1': { page: 1, kind: 'figura', text: 'Foto' } })).toBe('\n[[página 1]]\nA\n[Imagem p. 1: Foto]')
  })
  it('missingImageBrackets acha o quadro que a IA omitiu (ignora espaços/quebras)', () => {
    const src = 'Paciente de 70 anos…\n[Imagem p. 15: POP-Q — Aa +2; Ba +3]\n[Imagem p. 15: Foto da lesão]'
    expect(missingImageBrackets(src, 'Paciente de 70 anos…\n[Imagem p. 15: Foto da  lesão]')).toEqual(['[Imagem p. 15: POP-Q — Aa +2; Ba +3]'])
  })
  it('imageDescriptionsIn lista as transcrições do trecho', () => {
    const t = 'x\n[Imagem p. 2: POP-Q — Aa 0]\n[Imagem p. 3]\n[Imagem p. 4 — texto da imagem:]\nQUESTÃO 1\n[Imagem p. 4 — fim]'
    expect(imageDescriptionsIn(t)).toEqual(['p. 2: POP-Q — Aa 0', 'p. 3: imagem não transcrita', 'p. 4: QUESTÃO 1'])
  })
  it('reflowTranscription recoloca as quebras que o segmentador usa', () => {
    expect(reflowTranscription('d. Fim do item. QUESTÃO 4. Ana marque V ou F. ( ) Primeira afirmativa. ( ) Segunda afirmativa. a) Qual? b) Por quê? Resposta: sim')).toBe(
      'd. Fim do item.\nQUESTÃO 4. Ana marque V ou F.\n( ) Primeira afirmativa.\n( ) Segunda afirmativa.\na) Qual?\nb) Por quê?\nResposta: sim',
    )
    expect(reflowTranscription('QUESTÃO 2. Observe: POP-Q — Aa -1; Ba 0; C -4; D -6 a. Qual o diagnóstico?')).toBe('QUESTÃO 2. Observe:\nPOP-Q — Aa -1; Ba 0; C -4; D -6\na. Qual o diagnóstico?')
  })
})
