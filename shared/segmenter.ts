/**
 * Segmentação DETERMINÍSTICA de questões a partir do texto extraído do PDF (pdf.js).
 *
 * Saída: Questão = ENUNCIADO + PERGUNTAS (subitens), cada pergunta com a resposta encontrada.
 *
 * Por que existe: reduz o custo de IA (o LLM recebe blocos já separados, em lotes) e é o
 * fallback quando todos os modelos falham — o usuário recebe os blocos para revisar.
 * A qualidade é medida contra o gabarito de referência: `npm run eval:import` (docs/10-avaliacao-importador.md).
 *
 * Padrões suportados (observados nos PDFs de exemplo):
 *  - início de questão: "QUESTÃO 8." / "Questão 2 -" / "QUESTÃO 1.1" / "1) Mulher de 38 anos…" /
 *    "Estação 1B.3 — Título" / "Caso 4 — …" (no início da linha; "Fonte: Lista 1, Questão 27" NÃO é início)
 *  - seções: linhas em CAIXA ALTA ("CA DE MAMA") e "ASSUNTO: …"; título de tema "1A — Miomas" / "Tema 2 – …"
 *    logo antes de uma questão (sufixo "— Gabarito" removido)
 *  - perguntas: "a." / "b)" no início da linha, em sequência (a, b, c…), ou "Parte 2:", "Parte 3:"… em sequência
 *  - fim da pergunta: "?" (+ "Justifique." / "Explique." na sequência) ou comando terminado em ":"/"."
 *
 * Questões e respostas em arquivos separados (ou gabarito no fim do PDF): shared/answer-key.ts.
 */

export interface SegmentedItem {
  /** "a", "b", "Parte 2"… (ausente na pergunta única) */
  label?: string
  /** Texto da pergunta ('' na pergunta única) */
  prompt: string
  answer?: string
  /** A resposta veio do gabarito (outro arquivo ou seção de respostas), não do texto da questão. */
  answerSource?: 'gabarito'
  /** Objetiva montada pelo gabarito de letras ("1-C"): alternativas (a, b, c…) e a letra correta. */
  choices?: { label: string; text: string }[]
  correct?: string
}

export interface SegmentedQuestion {
  key: string
  sourceLabel?: string
  section?: string
  /**
   * Título do cabeçalho ("Estação 1.12 — Mioma parido"). Fica FORA do enunciado: muitas vezes é a própria
   * resposta. Só serve de pista para a classificação.
   */
  title?: string
  stem: string
  items: SegmentedItem[]
  page?: number
  /** Avisos para a revisão (ex.: resposta não encontrada no gabarito). */
  flags?: string[]
}

export interface SegmentOptions {
  /**
   * texto antes da 1ª questão é capa/instruções/legenda (guia do documento,
   * shared/document-guide.ts) — não vira questão, mesmo sendo longo.
   */
  skipPreamble?: boolean
  /**
   * false: o documento só tem questões (as respostas estão em outro arquivo/seção). O texto depois do "?"
   * continua sendo da pergunta ("Cite três fatores de risco.") em vez de virar resposta.
   */
  answers?: boolean
  /** false: só cabeçalhos explícitos (QUESTÃO/Estação/Caso) — usado no gabarito, onde "1. …" é enumeração da resposta. */
  numbered?: boolean
  /** Gabarito: todo "a)"/"Parte N" é resposta ("Parte 1" sem "?" também; aceita etapas puladas: 2, 4, 5). */
  key?: boolean
}

const PAGE_MARK = /\[\[página (\d+)\]\]/g

const tidy = (s: string) =>
  s
    .replace(PAGE_MARK, '\n')
    .replace(/\$([^$\n]{1,40})\$/g, (_, m: string) => m.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\/g, '')) // LaTeX inline
    .replace(/[​ ]/g, ' ')
    .replace(/^[ \t]*[○●▪◦•][ \t]*/gm, '- ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * Junta quebras de linha "de página" no meio de frases (o PDF quebra pela largura da coluna),
 * preservando parágrafos, listas e enumerações.
 */
export function reflow(s: string): string {
  return s.replace(/([^.:;?!\n])\n(?!\s*(?:[a-h][.)]\s|\d{1,2}[.)]\s|[-•●]|\n))/g, '$1 ').replace(/ {2,}/g, ' ')
}

const IMPERATIVE = /^(justifique|explique|comente|cite|descreva|fundamente|argumente|discuta|por qu[eê]|e por qu[eê])\b[^?!]{0,80}[.?!:]?$/i
const COMMAND_VERBS =
  /\b(qual|quais|como|cite|descreva|explique|justifique|comente|d[eê]|sugira|fa[cç]a|indique|proponha|aponte|responda|interprete|classifique|diferencie|caracterize|defina|o que|discorra|disserte|analise|elabore|apresente|enumere|liste|compare|calcule|determine|assinale|marque|julgue|avalie|oriente|estadie|conduta)\b/i

/** Separa o texto da pergunta da resposta que vem logo depois dela. */
export function splitPromptAnswer(text: string): { prompt: string; answer?: string } {
  const lines = text.split('\n')
  const maxLines = Math.min(lines.length, 25)
  for (let i = 0; i < maxLines; i++) {
    const line = lines[i]
    const q = line.lastIndexOf('?')
    if (q < 0) continue
    const after = line.slice(q + 1).trim()
    if (!after || IMPERATIVE.test(after)) {
      let end = i
      if (end + 1 < lines.length && IMPERATIVE.test(lines[end + 1].trim())) end++
      const answer = lines.slice(end + 1).join('\n').trim()
      return { prompt: lines.slice(0, end + 1).join('\n').trim(), answer: answer || undefined }
    }
    // "?" no meio da linha seguido da resposta (texto colado): corta no "?" (+ imperativo curto)
    const imp = after.match(/^(Justifique|Explique|Comente|Por qu[eê])[^.?!]{0,60}[.?!]\s*/i)
    const firstQ = line.indexOf('?')
    const cutAt = imp ? q + 1 + (line.slice(q + 1).length - after.length) + imp[0].length : firstQ + 1
    const prompt = [...lines.slice(0, i), line.slice(0, cutAt)].join('\n').trim()
    const answer = [line.slice(cutAt), ...lines.slice(i + 1)].join('\n').trim()
    return { prompt, answer: answer || undefined }
  }
  // Sem "?": a frase de comando ("…discorra sobre a melhor conduta.") termina em ":" ou "." no fim da linha
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (!/[:.]\s*$/.test(lines[i])) continue
    const sentence = lines
      .slice(0, i + 1)
      .join(' ')
      .split(/(?<=[.:;!?])\s+/)
      .filter(Boolean)
      .at(-1)
    if (sentence && COMMAND_VERBS.test(sentence)) {
      const answer = lines.slice(i + 1).join('\n').trim()
      return { prompt: lines.slice(0, i + 1).join('\n').trim(), answer: answer || undefined }
    }
  }
  const [first, ...rest] = lines
  return { prompt: first.trim(), answer: rest.join('\n').trim() || undefined }
}

interface Mark {
  index: number
  kind: 'question' | 'section'
  label?: string
  section?: string
  /** Onde começa o corpo (depois do cabeçalho e do título, que não entram no enunciado). */
  bodyStart?: number
  title?: string
}

/** Identificador da estação/caso: "1.1", "1B.10", "E.2", "4". */
const STATION_ID = String.raw`(?:\d{1,3}[A-Z]?|[A-Z])(?:\.\d{1,3})?`
/** "Estação 1B.3 — Título" / "Caso 4: …" no início da linha (grupos: palavra, id, título). */
const STATION_HEAD = new RegExp(String.raw`(?:^|\n)[ \t]*(ESTA[ÇC][ÃA]O|Esta[çc][ãa]o|CASO|Caso)\s+(${STATION_ID})(?![\w.])[ \t]*(?:[—–\-:.)][ \t]*([^\n]*))?`, 'g')
/**
 * "QUESTÃO 8." em qualquer ponto (texto de imagem transcrita às vezes vem colado), menos citações de
 * origem: "Fonte: Lista 1, Questão 27" / "(Questão 3)".
 */
const QUESTAO_HEAD = /(?<!Fonte:[^\n]*)(?<![,(]\s*)QUEST[ÃA]O\s*(\d{1,3}(?:\.\d{1,2})?)\s*[.:)\-–]?/gi

/** Uma linha que abre questão (usado pelo guia do documento e pelo gabarito). */
export const QUESTION_HEAD_LINE = new RegExp(String.raw`^[ \t]*(?:QUEST[ÃA]O\s*\d|(?:ESTA[ÇC][ÃA]O|Esta[çc][ãa]o|CASO|Caso)\s+${STATION_ID}(?![\w.]))`, 'i')

/**
 * Título de tema/capítulo antes das questões: "1A — Miomas", "Extra — Vulvovaginites", "Tema 2 - SOP",
 * "Unidade III: …". Bare code só com travessão (– ou —), para não confundir com "2 - item".
 */
const THEME_HEAD = /^(?:(?:\d{1,2}[A-Z]?|[A-Z]|Extra|EXTRA)\s+[—–]|(?:Tema|TEMA|Unidade|UNIDADE|Cap[íi]tulo|CAP[ÍI]TULO|M[óo]dulo|M[ÓO]DULO)\s+[\dIVX]{1,4}[A-Z]?\s*[—–:-])\s*(\S.{1,100})$/
/** Linha da legenda ("1A — Miomas — 17 estações"): lista de temas, não título. */
const THEME_COUNT = /[—–-]\s*\d{1,3}\s+(esta[çc][õo]es|quest[õo]es|casos|itens)\s*$/i
const ANSWER_SUFFIX = /\s*[—–-]?\s*(gabarito|respostas?|resolu[çc][ãa]o)\s*$/i
const CONTINUES = /([,(—–-]|\b(e|de|do|da|dos|das|ou|com|em|na|no|para))\s*$/i

/** Nome do tema a partir do título (sem o código, sem "— Gabarito"). */
const themeName = (s: string) => s.replace(ANSWER_SUFFIX, '').replace(/[\s—–-]+$/, '').replace(/\s+/g, ' ').trim()

/**
 * Títulos de tema: só valem quando a próxima linha relevante é um cabeçalho de questão (antes de outro título).
 * O título pode quebrar em 2 linhas ("1B — SUA (aguda, disfuncional, adolescência," + "coagulopatia)").
 */
function themeMarks(text: string): Mark[] {
  const lines: { at: number; text: string }[] = []
  let at = 0
  for (const raw of text.split('\n')) {
    lines.push({ at, text: raw.trim() })
    at += raw.length + 1
  }
  const isQuestion = (t: string) => QUESTION_HEAD_LINE.test(t)
  const out: Mark[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(THEME_HEAD)
    if (!m || THEME_COUNT.test(lines[i].text) || /\?\s*$/.test(lines[i].text) || isQuestion(lines[i].text)) continue
    let name = m[1]
    let j = i + 1
    for (let k = 0; k < 2 && j < lines.length; k++) {
      const next = lines[j].text
      if (!next || next.length > 60 || isQuestion(next) || THEME_HEAD.test(next) || /^\[\[|^Fonte\s*:|^[a-h]\s*[.)]\s|^parte\s+\d/i.test(next)) break
      if (!(CONTINUES.test(name) || /^\p{Ll}/u.test(next) || ANSWER_SUFFIX.test(` ${next}`))) break
      name = `${name} ${next}`
      j++
    }
    // próxima linha relevante: questão (vale) ou outro título (não vale)
    let ok = false
    for (let k = j; k < lines.length && k < j + 40; k++) {
      const t = lines[k].text
      if (isQuestion(t)) {
        ok = true
        break
      }
      if (THEME_HEAD.test(t) && !THEME_COUNT.test(t)) break
    }
    const section = themeName(name)
    if (ok && section.length >= 3) out.push({ index: lines[i].at, kind: 'section', section, bodyStart: lines[j]?.at ?? text.length })
    i = j - 1
  }
  return out
}

const CASE_START = /^(mulher|paciente|homem|gestante|primigesta|adolescente|jovem|crian[cç]a|uma? (mulher|paciente|jovem)|[A-ZÁÉÍÓÚ][a-záéíóúãõç]+,?\s+\d{1,2}\s*anos|[A-Z]{2,4},?\s+\d{1,2}\s*anos|[A-ZÁÉÍÓÚ][a-záéíóúãõç]+\s+tem\s+\d{1,2}\s*anos)/i

function findMarks(text: string, opts: { numbered?: boolean } = {}): Mark[] {
  const marks: Mark[] = []
  for (const m of text.matchAll(QUESTAO_HEAD)) {
    marks.push({ index: m.index ?? 0, kind: 'question', label: `QUESTÃO ${m[1]}` })
  }
  // "Estação 1.1 — Diagnóstico e fatores de risco" (OSCE) / "Caso 3 — …": o título fica fora do enunciado
  const questoes = marks.length
  const stations = [...text.matchAll(STATION_HEAD)].filter((m) => !/^c/i.test(m[1])).length
  for (const m of text.matchAll(STATION_HEAD)) {
    // "Caso 2: Aa -3 · …" dentro de uma estação/questão é parte dela, não cabeçalho
    if (/^c/i.test(m[1]) && (stations || questoes)) continue
    const index = (m.index ?? 0) + (m[0].startsWith('\n') ? 1 : 0)
    let bodyStart = (m.index ?? 0) + m[0].length
    let title = m[3]?.trim() || undefined
    // título quebrado: "… com e sem desejo" + "reprodutivo"
    const nextEnd = text.indexOf('\n', bodyStart + 1)
    const next = text.slice(bodyStart + 1, nextEnd >= 0 ? nextEnd : text.length).trim()
    if (title && next && next.length <= 50 && /^\p{Ll}/u.test(next) && !/[.?!:]$/.test(title) && !/^([a-h]\s*[.)]|parte\s+\d)/i.test(next)) {
      title = `${title} ${next}`
      bodyStart = nextEnd >= 0 ? nextEnd : text.length
    }
    const word = /^c/i.test(m[1]) ? 'Caso' : 'Estação'
    marks.push({ index, kind: 'question', label: `${word} ${m[2]}`, title, bodyStart })
  }
  marks.push(...themeMarks(text))
  // Numeração simples ("1) Mulher de 38 anos…", "4. Para o caso acima, quais…?", "10a. Mulher 23a…")
  // só quando parece início de questão: começa como caso clínico, ou a 1ª linha é uma pergunta/comando.
  for (const m of opts.numbered === false ? [] : text.matchAll(/(?:^|\n)[ \t]*(\d{1,2}[a-z]?)\s*[).]\s+(?=\S)/g)) {
    const start = (m.index ?? 0) + m[0].length
    const firstLine = text.slice(start, text.indexOf('\n', start) >= 0 ? text.indexOf('\n', start) : start + 200)
    const looksLikeQuestion = CASE_START.test(firstLine.slice(0, 60)) || /\?\s*$/.test(firstLine) || /\b(assinale|marque|julgue)\b/i.test(firstLine) || /^(sobre|para o caso|ainda sobre|caso de)\b/i.test(firstLine)
    if (looksLikeQuestion) marks.push({ index: (m.index ?? 0) + (m[0].startsWith('\n') ? 1 : 0), kind: 'question', label: `${m[1]})` })
  }
  // Seções: título em CAIXA ALTA seguido de "ASSUNTO:"/"Prof…", ou linha "ASSUNTO: …" (ex.: "CA DE MAMA" + "Prof Simone")
  // (lookahead na 2ª linha: casamentos não podem "consumir" a linha seguinte, senão títulos em linhas ímpares escapam)
  for (const m of text.matchAll(/(?:^|\n)([^\n]{4,80})(?=\n([^\n]{0,80}))/g)) {
    const line = m[1].trim()
    const next = m[2].trim()
    const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '')
    const isCaps = letters.length >= 5 && line === line.toLocaleUpperCase('pt-BR') && !/QUEST[ÃA]O|^[A-E]\)|^\d|[.;,]$/.test(line)
    const at = (m.index ?? 0) + (m[0].startsWith('\n') ? 1 : 0)
    if (isCaps && /^(ASSUNTO|Prof)/i.test(next)) marks.push({ index: at, kind: 'section', section: `${line} · ${next}` })
    else if (/^ASSUNTO\s*:/i.test(line) && /^Prof/i.test(next)) marks.push({ index: at, kind: 'section', section: `${line.replace(/^ASSUNTO\s*:\s*/i, '')} · ${next}` })
  }
  marks.sort((a, b) => a.index - b.index)
  // remove duplicatas no mesmo ponto (ex.: "QUESTÃO 1" também casando como caixa alta)
  return marks.filter((m, i) => !marks.slice(0, i).some((o) => Math.abs(o.index - m.index) < 3 && o.kind === m.kind))
}

function pageAt(text: string, index: number): number | undefined {
  let page: number | undefined
  for (const m of text.matchAll(PAGE_MARK)) {
    if ((m.index ?? 0) > index) break
    page = Number(m[1])
  }
  return page
}

/**
 * "Parte 2:", "Parte 3 –", "Parte 4, com desejo:"… no início da linha ou logo depois do fim de uma frase
 * ("…(oral, adesivo)? Parte 3: Para B…") — casos em etapas do OSCE.
 */
const PART_HEAD = /(?:^|\n|(?<=[?!.]) )[ \t]*Partes?\s+(\d{1,2})(?:\s*(?:e|a|,|\/)\s*(\d{1,2}))?(?:\s*[:.,)\-–—]|(?=[ \t]+\p{Lu}))[ \t]*/gu
/** Comando sem "?" ("Cite…", "Descreva…") — a etapa é pergunta, não só dados novos do caso. */
const IMPERATIVE_START = /(^|[.:;?]\s+)(cite|descreva|explique|justifique|comente|indique|proponha|liste|enumere|classifique|defina|discorra|calcule|determine|interprete|diferencie|caracterize|oriente|elabore|apresente|analise|compare|avalie|estadie|sugira|fa[cç]a|responda|qual|quais)\b/i
/** Dentro da questão, a resposta vem depois de um título próprio ("Resposta comentada", "Gabarito"). */
const INLINE_ANSWER_HEAD = /(?:^|\n)[ \t]*(?:respostas?(?:\s+(?:comentadas?|esperadas?|sugeridas?))?|gabarito(?:\s+comentado)?|coment[áa]rios?(?:\s+do professor)?|resolu[çc][ãa]o(?:\s+comentada)?)\s*:?[ \t]*(?=\n)/i

type BlockMode = 'inline' | 'questions' | 'key'

/**
 * Marcadores "a)…" (sequência) ou "Parte N" (sequência) que separam as perguntas do bloco.
 * `also`: no gabarito, "Parte 2 e 3 - …" responde as duas etapas.
 */
function itemMarks(body: string, mode: BlockMode): { label: string; index: number; len: number; also?: string[] }[] {
  const subs: { label: string; index: number; len: number; also?: string[] }[] = []
  let expected = 'a'
  for (const m of body.matchAll(/(?:^|\n)[ \t]*([a-h])\s*[.)][ \t]+/g)) {
    if (m[1] === expected) {
      subs.push({ label: m[1], index: m.index ?? 0, len: m[0].length })
      expected = String.fromCharCode(expected.charCodeAt(0) + 1)
    }
  }
  if (subs.length >= 2) return subs
  const parts: { n: number; to: number; index: number; len: number }[] = []
  for (const m of body.matchAll(PART_HEAD)) {
    const n = Number(m[1])
    const to = m[2] && Number(m[2]) > n && Number(m[2]) - n <= 3 ? Number(m[2]) : n
    const prev = parts[parts.length - 1]
    if (!prev || n === prev.to + 1 || (mode === 'key' && n > prev.to)) parts.push({ n, to, index: m.index ?? 0, len: m[0].length })
  }
  if (parts.length >= 2 || parts[0]?.n >= 2) {
    // "Parte 1" sem pergunta é o próprio caso (enunciado); no gabarito toda "Parte N" é resposta
    const first = mode !== 'key' && parts[0].n === 1 && !body.slice(parts[0].index, parts[1]?.index ?? body.length).includes('?') ? 1 : 0
    const asItems = parts.slice(first).map((p) => ({
      label: `Parte ${p.n}`,
      index: p.index,
      len: p.len,
      ...(p.to > p.n ? { also: Array.from({ length: p.to - p.n }, (_, k) => `Parte ${p.n + k + 1}`) } : {}),
    }))
    if (asItems.length) return asItems
  }
  return subs.length >= 1 && subs[0].index > 40 ? subs : []
}

function parseBlock(body: string, mode: BlockMode = 'inline'): { stem: string; items: SegmentedItem[] } {
  // Questão com a resposta depois de "Resposta comentada": perguntas antes, respostas (por rótulo) depois
  if (mode === 'inline') {
    const h = body.match(INLINE_ANSWER_HEAD)
    if (h && (h.index ?? 0) > 40) return parseWithAnswerSection(body.slice(0, h.index), body.slice((h.index ?? 0) + h[0].length))
  }
  const split = (chunk: string) => (mode === 'inline' ? splitPromptAnswer(chunk) : { prompt: chunk, answer: undefined })
  const marks = itemMarks(body, mode)
  if (marks.length) {
    const stem = reflow(tidy(body.slice(0, marks[0].index)))
    let items: SegmentedItem[] = marks.flatMap((s, i) => {
      const chunk = tidy(body.slice(s.index + s.len, marks[i + 1]?.index ?? body.length))
      const { prompt, answer } = split(chunk)
      const item = { label: s.label, prompt: reflow(prompt), answer: answer && reflow(answer) }
      // gabarito "Parte 2 e 3 - …": a mesma resposta vale para as duas etapas
      return mode === 'key' && s.also ? [item, ...s.also.map((label) => ({ ...item, label }))] : [item]
    })
    // Só questões: etapa sem pergunta ("Parte 3: Citologia normal; Hb 10,8.") é dado novo do caso → vai para a
    // etapa seguinte (o gabarito pula essa parte: "Parte 2 … Parte 4")
    if (mode === 'questions' && items.some((it) => it.label?.startsWith('Parte'))) {
      const merged: SegmentedItem[] = []
      let carry = ''
      items.forEach((it, i) => {
        const asks = it.prompt.includes('?') || IMPERATIVE_START.test(it.prompt)
        if (!asks && i < items.length - 1) carry = `${carry}${carry ? '\n' : ''}${it.label}: ${it.prompt}`
        else {
          merged.push(carry ? { ...it, prompt: `${carry}\n${it.prompt}` } : it)
          carry = ''
        }
      })
      items = merged
    }
    return { stem, items }
  }
  // Pergunta única: o enunciado já contém o comando
  const { prompt, answer } = split(tidy(body))
  return { stem: reflow(prompt), items: [{ prompt: '', answer: answer && reflow(answer) }] }
}

/**
 * Pergunta que recebe a resposta de um rótulo que a questão não tem: a que levou os dados dessa etapa
 * ("Parte 3: …" no texto), senão a próxima etapa, senão a última.
 */
export function extraAnswerTarget<T extends { label?: string; prompt: string }>(items: T[], label: string): T {
  const l = label.toLowerCase()
  const carried = items.find((it) => it.prompt.toLowerCase().includes(`${l}:`))
  if (carried) return carried
  const n = Number(l.match(/^parte (\d+)/)?.[1])
  const next = n ? items.find((it) => Number(it.label?.match(/^Parte (\d+)/i)?.[1]) > n) : undefined
  return next ?? items[items.length - 1]
}

/**
 * "…Parte 4: Tratamento?\nResposta comentada\nParte 2 - Investigação. …": as perguntas ficam antes do título,
 * as respostas depois, com o MESMO rótulo. Sem rótulos que casem, a questão vira pergunta única com a
 * resposta inteira (como antes: nada se perde).
 */
function parseWithAnswerSection(questionPart: string, answerPart: string): { stem: string; items: SegmentedItem[] } {
  const q = parseBlock(questionPart, 'questions')
  const answer = reflow(tidy(answerPart))
  if (!answer) return q
  const labeled = q.items.filter((i) => i.label)
  const keyMarks = itemMarks(answerPart, 'key')
  const byLabel = new Map(
    keyMarks.flatMap((m, i) => {
      const text = reflow(tidy(answerPart.slice(m.index + m.len, keyMarks[i + 1]?.index ?? answerPart.length)))
      return [m.label, ...(m.also ?? [])].map((l) => [l.toLowerCase(), text] as const)
    }),
  )
  const hits = labeled.filter((i) => byLabel.has(i.label!.toLowerCase())).length
  if (labeled.length && hits >= Math.ceil(labeled.length / 2)) {
    const intro = keyMarks.length ? reflow(tidy(answerPart.slice(0, keyMarks[0].index))) : ''
    const items = q.items.map((it, i) => {
      const a = it.label ? byLabel.get(it.label.toLowerCase()) : undefined
      return { ...it, answer: [i === 0 ? intro : '', a ?? ''].filter(Boolean).join('\n') || undefined }
    })
    // resposta de etapa que não virou pergunta (dados juntados à etapa seguinte): vai para essa etapa
    const used = new Set(labeled.map((i) => i.label!.toLowerCase()))
    for (const [label, text] of byLabel) {
      if (used.has(label) || items.some((it) => it.answer?.includes(text))) continue
      const target = extraAnswerTarget(items, label)
      target.answer = [target.answer, `${label.replace(/^./, (c) => c.toUpperCase())}: ${text}`].filter(Boolean).join('\n')
    }
    return { stem: q.stem, items }
  }
  // perguntas sem rótulo correspondente na resposta: pergunta única com tudo
  const prompts = q.items.map((it) => [it.label && `${it.label}:`, it.prompt].filter(Boolean).join(' ')).filter(Boolean)
  return { stem: [q.stem, ...prompts].filter(Boolean).join('\n'), items: [{ prompt: '', answer }] }
}

/** Linha "Fonte: Lista 2, Miomas, Cenário 1" logo depois do cabeçalho: metadado de origem, não enunciado. */
const SOURCE_LINE = /^\s*Fonte\s*:[^\n]*\n?/i

export function segmentQuestions(fullText: string, opts: SegmentOptions & { minChars?: number } = {}): SegmentedQuestion[] {
  const marks = findMarks(fullText, { numbered: opts.numbered })
  const out: SegmentedQuestion[] = []
  let section: string | undefined
  let n = 0
  const minChars = opts.minChars ?? 40

  const pushBlock = (start: number, end: number, label?: string, mark?: Mark) => {
    const raw = fullText.slice(mark?.bodyStart ?? start, end)
    const body = mark?.bodyStart != null ? raw.replace(/^\s*/, '').replace(SOURCE_LINE, '') : raw.replace(/^\s*(QUEST[ÃA]O\s*\d{1,3}(?:\.\d{1,2})?\s*[.:)\-–]?|\d{1,2}\s*[).])\s*/i, '')
    if (tidy(body).replace(/\s/g, '').length < minChars) return
    const parsed = parseBlock(body, opts.key ? 'key' : opts.answers === false ? 'questions' : 'inline')
    const { items } = parsed
    // Estação sem texto comum ("Estação 6.8 — Prevenção" + a, b, c): o título vira o enunciado (no gabarito, nunca)
    const stem = !parsed.stem.trim() && mark?.title && !opts.key && items.some((i) => i.label) ? `${mark.title}:` : parsed.stem
    if (!stem && !items.length) return
    out.push({ key: `Q${++n}`, sourceLabel: label, section, ...(mark?.title ? { title: mark.title } : {}), stem, items, page: pageAt(fullText, start) })
  }

  // Texto antes da primeira marca (ex.: comando comum de uma seção) só vira questão se for longo
  if (marks.length && !opts.skipPreamble && tidy(fullText.slice(0, marks[0].index)).length > 400) pushBlock(0, marks[0].index)

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    const end = marks[i + 1]?.index ?? fullText.length
    if (m.kind === 'section') {
      section = m.section
      // texto entre o título da seção e a próxima questão: questão sem rótulo (se for longo)
      // pula o título e a linha "ASSUNTO…/Prof…" (título de tema: só o título, já medido em bodyStart)
      const lineEnd = fullText.indexOf('\n', fullText.indexOf('\n', m.index) + 1)
      const afterTitle = m.bodyStart ?? (lineEnd >= 0 && lineEnd < end ? lineEnd : end)
      if (tidy(fullText.slice(afterTitle, end)).length > 400) pushBlock(afterTitle, end)
      continue
    }
    pushBlock(m.index, end, m.label, m)
  }
  if (!marks.length) pushBlock(0, fullText.length)
  return mergeRepeatedLabels(out)
}

/**
 * Enunciado em FOTO + respostas digitadas com o mesmo rótulo logo depois (medido em `Unidade II.pdf`
 * com a etapa de visão: "QUESTÃO 3. <caso clínico>…" vem da imagem e, em seguida, o texto do PDF repete
 * "QUESTÃO 3" só com "a) … resposta"). O bloco sem enunciado é unido ao anterior de mesmo rótulo
 * (até 3 blocos atrás, ±2 páginas) que ainda não tem nenhuma resposta. Sem imagens transcritas o padrão
 * praticamente não ocorre (métricas de texto inalteradas — docs/10 §7).
 */
function mergeRepeatedLabels(qs: SegmentedQuestion[]): SegmentedQuestion[] {
  const out: SegmentedQuestion[] = []
  for (const q of qs) {
    const noStem = q.stem.replace(/\s/g, '').length < 15
    const target =
      noStem && q.sourceLabel && q.items.some((i) => i.answer)
        ? out
            .slice(-3)
            .reverse()
            .find((p) => p.sourceLabel === q.sourceLabel && !p.items.some((i) => i.answer) && Math.abs((p.page ?? 0) - (q.page ?? 0)) <= 2)
        : undefined
    if (!target) {
      out.push(q)
      continue
    }
    const byLabel = new Map(target.items.filter((i) => i.label).map((i) => [i.label, i]))
    const sameLabels = q.items.every((i) => i.label && byLabel.has(i.label))
    target.items = sameLabels ? target.items.map((t) => ({ ...t, answer: q.items.find((i) => i.label === t.label)?.answer ?? t.answer })) : q.items
  }
  return out
}

/** Pontos-chave heurísticos (fallback sem IA): frases curtas e informativas da resposta. */
export function heuristicKeyPoints(answer: string | undefined, max = 4): string[] {
  if (!answer) return []
  return answer
    .split(/(?<=[.;!?])\s+|\n+|•|●/)
    .map((s) => s.replace(/^[\s\-–\d.)]+/, '').trim())
    .filter((s) => s.length >= 12)
    .map((s) => (s.length > 90 ? `${s.slice(0, 87)}…` : s))
    .slice(0, max)
}
