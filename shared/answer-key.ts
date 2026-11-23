/**
 * QUESTÕES E RESPOSTAS SEPARADAS — gabarito em outro PDF ou numa seção de respostas no fim do mesmo PDF.
 *
 * Tudo determinístico (custo zero, roda igual no navegador e no servidor):
 *
 *   detectDocumentRole   papel de cada arquivo: questões | respostas | misto (questão + resposta juntas)
 *   findAnswerSection    num PDF único, onde começa o gabarito ("GABARITO", "Respostas comentadas"…)
 *   parseAnswerKey       entradas do gabarito: por cabeçalho ("Estação 1.3", "QUESTÃO 7", "Caso 2") com itens
 *                        (a, b…/"Parte 2"), lista numerada ("1) …", "2. …") ou grade de letras ("1-A 2-C 3-B")
 *   linkAnswers          liga cada resposta à sua questão pelo número (k-ésima ocorrência do mesmo número,
 *                        para numeração que recomeça por seção), com deslocamento constante ("41…" × "1…")
 *                        e, sem números, pela ordem; e cada item pelo rótulo (a, b, "Parte 2")
 *   segmentImport        tudo junto: páginas de vários documentos (numeração global) → questões com resposta
 *
 * O que sobrar (questão sem resposta / resposta sem questão) vai para a IA só escolher pares de ids
 * (nó `link` em server/ai/pipelines/import-graph.ts) — o texto da resposta é sempre o do gabarito.
 * Medição: `npm run eval:link` (docs/10 §9). Spec 002, US6.
 */
import { detectDocumentGuide, pagesFromFullText, type DocumentGuide } from './document-guide'
import { extraAnswerTarget, segmentQuestions, type SegmentedItem, type SegmentedQuestion } from './segmenter'

export type DocumentRole = 'questoes' | 'respostas' | 'misto'

export const DOCUMENT_ROLES: { id: DocumentRole; label: string; hint: string }[] = [
  { id: 'misto', label: 'Questões com respostas', hint: 'Cada questão traz a resposta (ou o gabarito está no fim do arquivo).' },
  { id: 'questoes', label: 'Só questões', hint: 'As respostas estão em outro arquivo.' },
  { id: 'respostas', label: 'Gabarito / respostas', hint: 'Só as respostas, com a numeração das questões.' },
]

/** Um arquivo dentro da importação (páginas na numeração global, contínua entre os arquivos). */
export interface ImportDocument {
  name: string
  role: DocumentRole
  firstPage: number
  lastPage: number
}

export interface AnswerItem {
  /** "a", "parte 2"… (normalizado); ausente = resposta da questão inteira. */
  label?: string
  text: string
}

export interface AnswerEntry {
  id: string
  /** Chave de ligação ("1.3", "1b.2", "7"); null sem número. */
  key: string | null
  label?: string
  page?: number
  items: AnswerItem[]
  /** Gabarito de letra ("C"), com o comentário que vier junto. */
  letter?: string
  /** Texto completo (para a IA e para a lista de respostas sem questão). */
  text: string
}

export interface LinkReport {
  /** Entradas lidas do gabarito. */
  entries: number
  questions: number
  /** Questões que receberam alguma resposta do gabarito. */
  linkedQuestions: number
  totalItems: number
  answeredItems: number
  method: 'numero' | 'deslocamento' | 'ordem' | 'nenhum'
  /** Deslocamento aplicado (resposta n + offset = questão n). */
  offset?: number
  unmatchedQuestions: { key: string; label?: string; page?: number }[]
  orphanEntries: { id: string; key: string | null; label?: string; page?: number; preview: string }[]
}

export interface ImportSegmentation {
  questions: SegmentedQuestion[]
  link: LinkReport | null
  /** Respostas que não acharam questão (o nó `link` tenta ligar com IA). */
  orphans: AnswerEntry[]
  /** Guia do 1º documento de questões (capa, instruções, temas). */
  guide: DocumentGuide
  /** Página onde começa a seção de respostas de um PDF único (gabarito no fim). */
  answerSectionPage?: number
}

/* --------------------------------- chaves --------------------------------- */

/**
 * Chave de ligação a partir do rótulo: "Estação 1B.3" → "1b.3", "QUESTÃO 07" → "7", "12)" → "12",
 * "Questão 1.10" → "1.10". Zeros à esquerda e caixa não importam; o tipo do cabeçalho também não.
 */
export function questionKey(label: string | null | undefined): string | null {
  if (!label) return null
  const m =
    label.match(/(?:quest[ãa]o|esta[çc][ãa]o|caso)\s*(?:n[º°o.]\s*)?((?:\d{1,3}[a-z]?|[a-z])(?:\.\d{1,3})?)(?![\w.])/i) ??
    label.match(/^\s*(\d{1,3}[a-z]?(?:\.\d{1,3})?)\s*[).:\-–]?\s*$/i)
  if (!m) return null
  return m[1]
    .toLowerCase()
    .split('.')
    .map((p) => p.replace(/^0+(?=\d)/, ''))
    .join('.')
}

/** Rótulo de item normalizado: "a)" → "a", "Parte 2" → "parte 2", "b." → "b". */
export const itemKey = (label: string | undefined) =>
  label
    ?.trim()
    .toLowerCase()
    .replace(/[\s).:\-–—]+$/, '')
    .replace(/\s+/g, ' ') || undefined

/* ------------------------------ papel do arquivo ------------------------------ */

const ANSWER_WORDS = /\b(gabarito|respostas?|resolu[çc][ãa]o|resolvid[ao]s|coment[áa]rios|comentad[ao]s|chave de respostas)\b/i
const QUESTION_WORDS = /\b(quest[õo]es|perguntas|exerc[íi]cios|casos|esta[çc][õo]es|prova|simulado|lista)\b/i

/** Complemento do comando depois do "?" ("Cite três fatores.", "Justifique.") — ainda é pergunta. */
const COMMAND_TAIL = /^(cite|descreva|explique|justifique|comente|indique|liste|enumere|responda|discorra|fundamente|argumente|d[eê]|e |qual|quais|como|por qu|o que|quando|onde)/i

/**
 * Perguntas com texto de RESPOSTA depois do último "?" (≥ 15 caracteres que não são complemento do comando).
 * Só questões: quase nenhuma. Questão + resposta: quase todas.
 */
function answeredShare(qs: SegmentedQuestion[]): number {
  const chunks = qs.flatMap((q) => (q.items.some((i) => i.label) ? q.items.map((i) => i.prompt) : [q.stem])).filter((c) => c.includes('?'))
  if (!chunks.length) return 0
  const answered = chunks.filter((c) => {
    const tail = c.slice(c.lastIndexOf('?') + 1).trim()
    return tail.length >= 15 && !COMMAND_TAIL.test(tail)
  })
  return answered.length / chunks.length
}

/**
 * Papel provável de um arquivo, pela estrutura (o usuário confirma na tela):
 *  - gabarito: título com "Gabarito/Respostas" e sem "Questões", grade de letras, ou blocos numerados sem "?"
 *  - questões: blocos com "?" e quase nada depois do último "?" de cada pergunta
 *  - misto: o resto (resposta logo depois da pergunta, ou seção de gabarito no fim)
 */
export function detectDocumentRole(fullText: string): { role: DocumentRole; reason: string } {
  const pages = pagesFromFullText(fullText)
  const firstLines = (pages[0]?.text ?? fullText)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
  const titleAnswers = ANSWER_WORDS.test(firstLines) && !QUESTION_WORDS.test(firstLines.replace(ANSWER_WORDS, ''))
  const grid = parseGrid(fullText)
  // grade de letras que é (quase) o arquivo inteiro
  if (grid.length >= 2 && grid.length * 12 > fullText.replace(/\s/g, '').length / 20) return { role: 'respostas', reason: `grade de gabarito com ${grid.length} respostas` }

  const qs = segmentQuestions(fullText, { answers: false, skipPreamble: true, minChars: 1 }).filter((q) => q.sourceLabel)
  if (qs.length >= 2) {
    if (findAnswerSection(fullText)) return { role: 'misto', reason: 'questões com uma seção de gabarito no fim' }
    const withQ = qs.filter((q) => `${q.stem}\n${q.items.map((i) => i.prompt).join('\n')}`.includes('?')).length / qs.length
    if (withQ < 0.35) return { role: 'respostas', reason: `${qs.length} blocos numerados, quase sem perguntas` }
    if (titleAnswers && withQ < 0.6) return { role: 'respostas', reason: 'título de gabarito' }
    if (answeredShare(qs) < 0.3) return { role: 'questoes', reason: `${qs.length} questões sem resposta depois das perguntas` }
    return { role: 'misto', reason: 'respostas logo depois das perguntas' }
  }
  if (titleAnswers) return { role: 'respostas', reason: 'título de gabarito' }
  return { role: 'misto', reason: 'sem cabeçalhos numerados — tratado como questões com respostas' }
}

/* --------------------------------- gabarito --------------------------------- */

/** "1-A", "01) C", "2 – b", "Questão 3: D" (vários por linha ou um por linha). */
const GRID_PAIR = /(?:^|[\s|;,])(?:quest[ãa]o\s*)?(\d{1,3})\s*[-–—:.)]?\s*\(?([A-Ea-e])\)?(?=$|[\s|;,.])/gi

function parseGrid(text: string): { key: string; letter: string; page?: number }[] {
  const out: { key: string; letter: string; page?: number }[] = []
  let page: number | undefined
  for (const line of text.split('\n')) {
    const pm = line.match(/^\[\[página (\d+)\]\]$/)
    if (pm) {
      page = Number(pm[1])
      continue
    }
    const pairs = [...line.matchAll(GRID_PAIR)]
    // linha "solta" de texto ("2 e 3 são…") não é gabarito: a linha precisa ser quase só pares
    const rest = line.replace(GRID_PAIR, ' ').replace(/gabarito|respostas?|quest[ãa]o|letra|[|:;,.\-–—()\s]/gi, '')
    if (!pairs.length || rest.length > 3) continue
    for (const p of pairs) out.push({ key: String(Number(p[1])), letter: p[2].toUpperCase(), page })
  }
  // grade de verdade: chaves sem repetição em sequência crescente na maioria
  const keys = out.map((o) => Number(o.key))
  const increasing = keys.filter((k, i) => i > 0 && k > keys[i - 1]).length
  return out.length >= 2 && increasing >= (out.length - 1) * 0.7 ? out : []
}

/** "Letra C", "C)", "Alternativa c — porque…", "Resposta: B." → letra + comentário. */
function letterAnswer(text: string): { letter: string; comment?: string } | null {
  const m = text.trim().match(/^(?:(?:letra|alternativa|resposta|gabarito|correta)\s*[:\-–]?\s*)?\(?([A-Ea-e])\)?(?:\s*[.)]?\s*(?:[—–\-:]\s*|\n|\s+)([\s\S]*))?$/i)
  if (!m) return null
  const comment = m[2]?.trim()
  // "a) texto" com texto longo é item, não letra
  if (comment && /^[a-e]\)/i.test(text.trim()) && !/^(letra|alternativa|resposta|gabarito|correta)/i.test(text.trim())) return null
  return { letter: m[1].toUpperCase(), ...(comment ? { comment } : {}) }
}

const NUMBERED_ENTRY = /(?:^|\n)[ \t]*(\d{1,3})\s*[).:\-–—]\s+(?=\S)/g

/** Lista numerada "1) resposta…", "2. resposta…" (gabarito sem cabeçalhos). */
function parseNumbered(text: string): AnswerEntry[] {
  const marks = [...text.matchAll(NUMBERED_ENTRY)].map((m) => ({ n: Number(m[1]), index: m.index ?? 0, len: m[0].length }))
  // sequência crescente (pula enumerações internas "1. 2. 3." que reiniciam)
  const seq: typeof marks = []
  for (const m of marks) if (!seq.length || m.n === seq[seq.length - 1].n + 1) seq.push(m)
  if (seq.length < 2) return []
  return seq.map((m, i) => {
    const body = text.slice(m.index + m.len, seq[i + 1]?.index ?? text.length).replace(/\[\[página \d+\]\]/g, '\n').trim()
    const page = [...text.slice(0, m.index).matchAll(/\[\[página (\d+)\]\]/g)].pop()?.[1]
    const letter = letterAnswer(body)
    return { id: '', key: String(m.n), label: `${m.n})`, page: page ? Number(page) : undefined, items: letter ? [] : [{ text: body }], ...(letter ? { letter: letter.letter } : {}), text: body }
  })
}

/**
 * Entradas do gabarito. Ordem de preferência: blocos com cabeçalho (QUESTÃO/Estação/Caso) → lista numerada
 * → grade de letras (as letras que faltarem nos blocos também entram). Texto antes do 1º cabeçalho e o
 * resumo de cada tema ("Regra de ouro…", quadro FIGO) não são resposta de nenhuma questão.
 */
export function parseAnswerKey(text: string): AnswerEntry[] {
  const headed = segmentQuestions(text, { answers: false, key: true, numbered: false, skipPreamble: true, minChars: 1 }).filter((q) => q.sourceLabel)
  let entries: AnswerEntry[]
  if (headed.length >= 2) {
    entries = headed.map((q) => {
      const labeled = q.items.filter((i) => i.label)
      const whole = [q.stem, ...q.items.map((i) => (i.label ? `${i.label}) ${i.prompt}` : i.prompt))].filter(Boolean).join('\n').trim()
      const letter = !labeled.length ? letterAnswer(q.stem) : null
      const items: AnswerItem[] = labeled.length
        ? labeled.map((i, k) => ({ label: itemKey(i.label), text: k === 0 && q.stem ? `${q.stem}\n${i.prompt}` : i.prompt }))
        : letter
          ? []
          : [{ text: q.stem }]
      return { id: '', key: questionKey(q.sourceLabel), label: q.sourceLabel, page: q.page, items, ...(letter ? { letter: letter.letter } : {}), text: whole }
    })
  } else {
    entries = parseNumbered(text)
  }
  const have = new Set(entries.map((e) => e.key))
  const grid = parseGrid(text).filter((g) => !have.has(g.key))
  if (grid.length >= 2 && grid.length >= entries.length) {
    // grade dominante: as entradas "numeradas" eram a própria grade lida de outro jeito
    entries = entries.filter((e) => !grid.some((g) => g.key === e.key) && e.items.some((i) => i.text.length > 3))
  }
  for (const g of grid) entries.push({ id: '', key: g.key, label: `${g.key})`, page: g.page, items: [], letter: g.letter, text: g.letter })
  return entries.filter((e) => e.text.trim()).map((e, i) => ({ ...e, id: `r${i + 1}` }))
}

/* ------------------------------ PDF único com gabarito no fim ------------------------------ */

/** Título da seção de respostas: a linha começa com a palavra, ou termina com "— Gabarito". */
const ANSWER_HEADING = /^(?:(?:gabarito|respostas?|resolu[çc][ãa]o|chave de respostas)(?:\s+(?:oficial|comentad[oa]s?|esperadas?|das quest[õo]es|da prova|da lista))?\s*:?|.{2,70}[—–\-|:]\s*(?:gabarito|respostas?(?:\s+comentadas)?|resolu[çc][ãa]o))\s*$/i

/**
 * Onde começa o gabarito num PDF que tem questões e depois as respostas. O título só vale se o texto
 * depois dele parecer gabarito: ≥ 2 entradas, ≥ 60% delas com o número de uma questão de antes e quase
 * nenhuma com "?". Devolve o índice no texto (início da linha do título).
 */
export function findAnswerSection(fullText: string): { index: number; page?: number } | null {
  let at = 0
  let firstQuestionSeen = false
  let page: number | undefined
  for (const raw of fullText.split('\n')) {
    const line = raw.trim()
    const pm = line.match(/^\[\[página (\d+)\]\]$/)
    if (pm) page = Number(pm[1])
    else if (/^[ \t]*(QUEST[ÃA]O\s*\d|ESTA[ÇC][ÃA]O\s|Esta[çc][ãa]o\s|CASO\s+\d|Caso\s+\d)/.test(line)) firstQuestionSeen = true
    else if (firstQuestionSeen && line.length <= 90 && ANSWER_HEADING.test(line) && !/\?$/.test(line)) {
      const before = fullText.slice(0, at)
      const after = fullText.slice(at + raw.length)
      const qs = segmentQuestions(before, { answers: false, skipPreamble: true }).filter((q) => q.sourceLabel)
      const keys = new Set(qs.map((q) => questionKey(q.sourceLabel)))
      const entries = parseAnswerKey(after)
      const matched = entries.filter((e) => e.key && keys.has(e.key)).length
      const asking = entries.filter((e) => e.items.some((i) => i.text.includes('?'))).length
      if (qs.length >= 2 && entries.length >= 2 && matched >= Math.max(2, entries.length * 0.6) && asking <= entries.length * 0.35) return { index: at, page }
    }
    at += raw.length + 1
  }
  return null
}

/* --------------------------------- ligação --------------------------------- */

/** Aviso da questão que ficou sem resposta no gabarito (o nó `link` procura por ele). */
export const NO_ANSWER_IN_KEY = 'Resposta não encontrada no gabarito — revise'

/** Sobras por chamada do nó `link` (questões e respostas). */
export const LINK_MAX = 40

const ALTERNATIVE_LABELS = 'abcdefgh'

/** Os "itens" a), b), c)… de uma questão sem respostas são, na verdade, alternativas de uma objetiva? */
const looksLikeAlternatives = (q: SegmentedQuestion) =>
  q.items.length >= 3 && q.items.every((it, i) => it.label === ALTERNATIVE_LABELS[i] && !it.answer && !it.prompt.includes('?')) && /[?:]\s*$|\b(assinale|marque|indique|qual|quais)\b/i.test(q.stem)

/** Aplica UMA entrada do gabarito à questão; devolve a questão nova e os avisos. */
export function applyEntry(q: SegmentedQuestion, e: AnswerEntry, how: LinkReport['method'] | 'ia' = 'numero'): SegmentedQuestion {
  const flags = [...(q.flags ?? [])]
  let items: SegmentedItem[] = q.items.map((i) => ({ ...i }))
  const fill = (it: SegmentedItem, text: string) => {
    if (it.answer || !text.trim()) return
    it.answer = text.trim()
    it.answerSource = 'gabarito'
  }
  if (e.letter) {
    const comment = e.items.map((i) => i.text).join('\n').trim() || undefined
    if (looksLikeAlternatives(q)) {
      items = [
        {
          prompt: '',
          choices: q.items.map((i) => ({ label: i.label!, text: i.prompt })),
          correct: e.letter,
          answer: comment,
          answerSource: 'gabarito',
        },
      ]
      if (!q.items.some((i) => i.label === e.letter!.toLowerCase())) flags.push(`Gabarito indica a letra ${e.letter}, que não está entre as alternativas — revise`)
    } else if (items.length === 1) {
      fill(items[0], `Gabarito: letra ${e.letter}${comment ? ` — ${comment}` : ''}`)
      items[0].correct = e.letter
    } else {
      fill(items[0], `Gabarito: letra ${e.letter}${comment ? ` — ${comment}` : ''}`)
      flags.push('Gabarito de letra para questão com várias perguntas — revise')
    }
  } else {
    const byLabel = new Map(e.items.filter((i) => i.label).map((i) => [i.label!, i]))
    const unlabeled = e.items.filter((i) => !i.label)
    const used = new Set<string>()
    const labeledQ = items.filter((i) => i.label)
    if (labeledQ.length && byLabel.size) {
      for (const it of items) {
        const k = itemKey(it.label)
        const hit = k ? byLabel.get(k) : undefined
        if (hit) {
          fill(it, hit.text)
          used.add(k!)
        }
      }
      const missing = items.filter((i) => !i.answer).length
      if (missing) flags.push(`${missing} pergunta(s) sem resposta no gabarito — revise`)
      const extra = [...byLabel.keys()].filter((k) => !used.has(k) && !items.some((it) => it.answer?.includes(byLabel.get(k)!.text)))
      const unexplained: string[] = []
      for (const k of extra) {
        // resposta de item que a questão não tem: não se perde. Etapa juntada à seguinte ("Parte 3: dados…")
        // vai para essa etapa sem aviso; o resto vai para a última pergunta, com aviso.
        const target = extraAnswerTarget(items, k)
        if (!target.prompt.toLowerCase().includes(`${k}:`)) unexplained.push(k)
        const shown = k.startsWith('parte') ? `${k.replace(/^./, (c) => c.toUpperCase())}:` : `${k})`
        target.answer = [target.answer, `${shown} ${byLabel.get(k)!.text}`].filter(Boolean).join('\n')
        target.answerSource = 'gabarito'
      }
      if (unexplained.length) flags.push(`Gabarito tem resposta para item(ns) que a questão não tem (${unexplained.join(', ')}) — revise`)
    } else if (items.length === 1) {
      // questão de pergunta única: o gabarito inteiro (com itens, se houver) é a resposta
      fill(items[0], e.items.map((i) => (i.label ? `${i.label}) ${i.text}` : i.text)).join('\n'))
    } else {
      const text = (unlabeled.length ? unlabeled : e.items).map((i) => (i.label ? `${i.label}) ${i.text}` : i.text)).join('\n')
      fill(items[0], text)
      flags.push('Gabarito sem separação por pergunta: a resposta inteira ficou na 1ª pergunta — revise')
    }
  }
  if (how === 'ordem') flags.push('Resposta ligada pela ORDEM (sem número em comum) — confira')
  if (how === 'ia') flags.push('Resposta ligada pela IA (sem número em comum) — confira')
  if (how === 'deslocamento') flags.push('Resposta ligada com numeração deslocada — confira')
  return { ...q, items, ...(flags.length ? { flags } : {}) }
}

/**
 * Liga as entradas do gabarito às questões. Questões que já têm resposta no próprio texto não são
 * sobrescritas (só os itens vazios recebem). Devolve as questões novas, o relatório e as entradas órfãs.
 */
export function linkAnswers(questions: SegmentedQuestion[], entries: AnswerEntry[]): { questions: SegmentedQuestion[]; report: LinkReport; orphans: AnswerEntry[] } {
  const qKeys = questions.map((q) => questionKey(q.sourceLabel))
  const pairOf = new Map<number, number>() // questão → entrada
  const usedEntries = new Set<number>()
  let method: LinkReport['method'] = 'numero'
  let offset: number | undefined

  const matchBy = (keyOfEntry: (e: AnswerEntry) => string | null) => {
    const pairs = new Map<number, number>()
    const byKey = new Map<string, number[]>()
    entries.forEach((e, i) => {
      const k = keyOfEntry(e)
      if (k) byKey.set(k, [...(byKey.get(k) ?? []), i])
    })
    const seen = new Map<string, number>()
    qKeys.forEach((k, qi) => {
      if (!k) return
      const occ = seen.get(k) ?? 0
      seen.set(k, occ + 1)
      const list = byKey.get(k)
      // k-ésima questão "3" ↔ k-ésima resposta "3" (numeração que recomeça por seção/unidade)
      const ei = list?.[occ]
      if (ei !== undefined) pairs.set(qi, ei)
    })
    return pairs
  }

  let pairs = matchBy((e) => e.key)
  const numericQ = qKeys.filter((k): k is string => !!k && /^\d+$/.test(k)).map(Number)
  const numericE = entries.map((e) => e.key).filter((k): k is string => !!k && /^\d+$/.test(k)).map(Number)
  if (pairs.size < Math.min(questions.length, entries.length) * 0.5 && numericQ.length >= 2 && numericE.length >= 2) {
    // "41, 42…" no gabarito × "1, 2…" nas questões (2º caderno): tenta o deslocamento entre os menores números
    const d = Math.min(...numericE) - Math.min(...numericQ)
    if (d !== 0) {
      const shifted = matchBy((e) => (e.key && /^\d+$/.test(e.key) ? String(Number(e.key) - d) : null))
      if (shifted.size >= Math.min(questions.length, entries.length) * 0.8) {
        pairs = shifted
        method = 'deslocamento'
        offset = d
      }
    }
  }
  for (const [qi, ei] of pairs) {
    pairOf.set(qi, ei)
    usedEntries.add(ei)
  }
  // Sem números em comum: mesma quantidade dos dois lados → pela ordem (marcado para conferir)
  const leftQ = questions.map((_, i) => i).filter((i) => !pairOf.has(i))
  const leftE = entries.map((_, i) => i).filter((i) => !usedEntries.has(i))
  if (!pairs.size && leftQ.length && leftQ.length === leftE.length) {
    leftQ.forEach((qi, k) => {
      pairOf.set(qi, leftE[k])
      usedEntries.add(leftE[k])
    })
    method = 'ordem'
  }
  if (!pairOf.size) method = 'nenhum'

  const out = questions.map((q, qi) => {
    const ei = pairOf.get(qi)
    if (ei === undefined) {
      const missing = q.items.some((i) => !i.answer && !i.choices)
      return missing && entries.length ? { ...q, flags: [...(q.flags ?? []), NO_ANSWER_IN_KEY] } : q
    }
    return applyEntry(q, entries[ei], method)
  })
  const orphans = entries.filter((_, i) => !usedEntries.has(i))
  const items = out.flatMap((q) => q.items)
  return {
    questions: out,
    orphans,
    report: {
      entries: entries.length,
      questions: questions.length,
      linkedQuestions: pairOf.size,
      totalItems: items.length,
      answeredItems: items.filter((i) => i.answer || i.choices).length,
      method,
      ...(offset !== undefined ? { offset } : {}),
      unmatchedQuestions: out.filter((_, qi) => !pairOf.has(qi)).map((q) => ({ key: q.key, label: q.sourceLabel, page: q.page })),
      orphanEntries: orphans.slice(0, 50).map((e) => ({ id: e.id, key: e.key, label: e.label, page: e.page, preview: e.text.replace(/\s+/g, ' ').slice(0, 200) })),
    },
  }
}

/* --------------------------------- tudo junto --------------------------------- */

const PAGE_RE = /\[\[página (\d+)\]\]/g

/** Recorta do texto completo (com `[[página N]]`) as páginas [first, last]. */
export function textOfPages(fullText: string, first: number, last: number): string {
  const marks = [...fullText.matchAll(PAGE_RE)]
  if (!marks.length) return first <= 1 ? fullText : ''
  let start = -1
  let end = fullText.length
  for (const m of marks) {
    const p = Number(m[1])
    if (start < 0 && p >= first) start = Math.max(0, (m.index ?? 0) - 1)
    if (p > last) {
      end = m.index ?? fullText.length
      break
    }
  }
  return start < 0 ? '' : fullText.slice(start, end)
}

/** Documentos válidos (intervalos dentro do texto, sem sobreposição); vazio → um documento "misto". */
export function normalizeDocuments(docs: ImportDocument[] | undefined): ImportDocument[] | null {
  if (!docs?.length) return null
  const sorted = [...docs].sort((a, b) => a.firstPage - b.firstPage)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].lastPage < sorted[i].firstPage) return null
    if (i && sorted[i].firstPage <= sorted[i - 1].lastPage) return null
  }
  return sorted
}

/**
 * Segmentação de uma importação inteira: um ou vários PDFs (páginas numeradas em sequência), cada um com
 * o seu papel. Sem `docs` (ou com um só "misto") é o comportamento de sempre, mais a detecção do gabarito no
 * fim do PDF. Cliente (resumo antes de processar) e servidor (nó `segment`) usam a mesma função.
 */
export function segmentImport(fullText: string, docs?: ImportDocument[]): ImportSegmentation {
  const list = normalizeDocuments(docs) ?? [{ name: '', role: 'misto' as const, firstPage: 1, lastPage: Number.MAX_SAFE_INTEGER }]
  const single = list.length === 1
  const textOf = (d: ImportDocument) => (single ? fullText : textOfPages(fullText, d.firstPage, d.lastPage))
  let questions: SegmentedQuestion[] = []
  const entries: AnswerEntry[] = []
  let guide: DocumentGuide | undefined
  let answerSectionPage: number | undefined

  for (const d of list) {
    const text = textOf(d)
    if (!text.trim()) continue
    if (d.role === 'respostas') {
      entries.push(...parseAnswerKey(text))
      continue
    }
    const g = detectDocumentGuide(pagesFromFullText(text))
    guide ??= g
    const opts = { skipPreamble: g.hasFrontMatter }
    if (d.role === 'questoes') {
      questions.push(...segmentQuestions(text, { ...opts, answers: false }))
      continue
    }
    const section = findAnswerSection(text)
    if (section) {
      answerSectionPage ??= section.page
      questions.push(...segmentQuestions(text.slice(0, section.index), { ...opts, answers: false }))
      entries.push(...parseAnswerKey(text.slice(section.index)))
    } else {
      questions.push(...segmentQuestions(text, opts))
    }
  }
  // chaves únicas entre documentos (cada documento começa em Q1)
  questions = questions.map((q, i) => ({ ...q, key: `Q${i + 1}` }))
  const ids = entries.map((e, i) => ({ ...e, id: `r${i + 1}` }))
  guide ??= detectDocumentGuide(pagesFromFullText(fullText))
  if (!ids.length) {
    const hasAnswerDoc = list.some((d) => d.role === 'respostas')
    return { questions, link: hasAnswerDoc ? emptyReport(questions) : null, orphans: [], guide, answerSectionPage }
  }
  const linked = linkAnswers(questions, ids)
  return { questions: linked.questions, link: linked.report, orphans: linked.orphans, guide, answerSectionPage }
}

function emptyReport(questions: SegmentedQuestion[]): LinkReport {
  const items = questions.flatMap((q) => q.items)
  return {
    entries: 0,
    questions: questions.length,
    linkedQuestions: 0,
    totalItems: items.length,
    answeredItems: items.filter((i) => i.answer).length,
    method: 'nenhum',
    unmatchedQuestions: questions.map((q) => ({ key: q.key, label: q.sourceLabel, page: q.page })),
    orphanEntries: [],
  }
}

/** Resumo do relatório em uma frase (avisos da revisão e da tela de PDF). */
export function linkSummary(r: LinkReport): string {
  if (!r.entries) return 'Nenhuma resposta reconhecida no gabarito — confira o papel de cada arquivo.'
  const how = r.method === 'deslocamento' ? ` (numeração deslocada em ${r.offset})` : r.method === 'ordem' ? ' (pela ordem — confira)' : ''
  const parts = [`Gabarito: ${r.linkedQuestions} de ${r.questions} questões ligadas às respostas${how}; ${r.answeredItems} de ${r.totalItems} perguntas com resposta`]
  if (r.orphanEntries.length) parts.push(`${r.entries - r.linkedQuestions} resposta(s) sem questão correspondente`)
  return `${parts.join('; ')}.`
}
