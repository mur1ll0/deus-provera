/**
 * GUIA DO DOCUMENTO — o que o próprio PDF diz sobre como está organizado, lido sem IA (custo zero).
 *
 * Muitos materiais trazem, antes da 1ª questão, uma capa ("QUESTÕES OSCE · GINECOLOGIA"), instruções
 * ("Como usar este material") e uma legenda de temas por questão:
 *
 *     Lista de questões
 *     Questões Temas principais
 *     01-04 Incontinência urinária e prolapso
 *     05-07 Sangramento uterino anormal e
 *     endométrio
 *     12,18,38,42,43,45,48-50 HPV, NIC e câncer de colo
 *
 * Esta etapa detecta: título (capa / cabeçalho repetido nas páginas), linhas explícitas
 * ("Disciplina: …", "Área: …"), o texto das instruções e a legenda questão → assunto.
 * O nó `classify` (server/ai/pipelines/import-graph.ts) usa o guia ANTES da IA: questão coberta pela
 * legenda + disciplina reconhecida na taxonomia vai direto para o card certo (sem requisição); o resto vai
 * à IA com o guia como pista. Também funciona quando a cota de IA acabou. docs/05 §5.2.
 *
 * O conteúdo do guia é DADO do usuário: nunca vira instrução de sistema (vai embrulhado em wrapUntrusted).
 */
import { QUESTION_HEAD_LINE } from './segmenter'

export interface TopicRule {
  /** Números das questões cobertas ("01-04" → 1, 2, 3, 4). */
  numbers: number[]
  /** Tema indicado pelo documento (vira o Assunto do card). */
  assunto: string
  /** Como os números aparecem no documento ("12,18,38,48-50"), para a descrição do card. */
  source: string
}

export interface DocumentGuide {
  /** Título do material (cabeçalho repetido ou 1ª linha da capa). */
  title?: string
  /** Linhas da capa/cabeçalho onde se procura a disciplina (ex.: "QUESTÕES OSCE", "GINECOLOGIA"). */
  titleLines: string[]
  /**
   * Valores explícitos ("Disciplina: Ginecologia", "Área: Medicina"). "ASSUNTO: …" fica de fora: nos
   * PDFs de exemplo é título de SEÇÃO (às vezes o nome do professor) e já vira `section` no segmentador.
   */
  explicit: { area?: string; disciplina?: string }
  /** Texto das instruções do documento ("Como usar este material", "Instruções"…). */
  instructions?: string
  /** Legenda questão → tema (vazia se o documento não tiver). */
  topics: TopicRule[]
  /**
   * Temas por código ("1A — Miomas — 17 estações"): valem para as questões sob o título do tema
   * (`section`). Ausente em jobs antigos.
   */
  themes?: { code: string; name: string }[]
  /** Página onde está a legenda/instruções (para a mensagem na revisão). */
  page?: number
  /** O documento tem capa/guia antes da 1ª questão: esse trecho não deve virar questão. */
  hasFrontMatter: boolean
}

export interface TaxonomyEntry {
  area: string
  discipline: string
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

const PAGE_MARK = /\[\[página (\d+)\]\]/g
const IMAGE_MARK = /\[\[imagem [^\]]*\]\]/g
/** Início da 1ª questão: "QUESTÃO 01", "Questão 2 -", "Estação 1.1 —", "Caso 3:"… (mesma regra do segmentador). */
const QUESTION_HEAD = QUESTION_HEAD_LINE
/** Rodapé/numeração de página. */
const PAGE_FOOTER = /^(p[áa]gina|p[áa]g\.?)\s*\d{1,4}(\s*(de|\/)\s*\d{1,4})?$|^\d{1,4}$/i
const INSTRUCTIONS_HEAD =
  /^(como (usar|utilizar|estudar|treinar)( (este|esse|o))? ?(material|caderno|apostila|documento|livro|guia)?|instru[çc][õo]es( gerais| de uso| para (uso|o estudo))?|orienta[çc][õo]es( gerais| de estudo)?|leia (com aten[çc][ãa]o|atentamente)|observa[çc][õo]es( gerais| importantes)?|apresenta[çc][ãa]o|sobre (este|esse|o) material|nota (ao|aos) (leitor|leitores|estudantes?))\s*:?$/i
/** Instrução na mesma linha do título: "Como treinar: leia o caso, responda…". */
const INSTRUCTIONS_INLINE = /^(como (usar|utilizar|estudar|treinar)( (este|esse|o))? ?(material|caderno|apostila|documento|livro|guia)?|instru[çc][õo]es|orienta[çc][õo]es)\s*:\s*(\S.{10,})$/i
/**
 * Legenda de TEMAS por código (não por número de questão): "1A — Miomas — 17 estações", "Extra — Vulvovaginites".
 * O tema vale para as questões sob o título de mesmo nome (`section` do segmentador).
 */
const THEME_LEGEND = /^((?:\d{1,2}[A-Z]?|[A-Z]|Extra|EXTRA|Tema\s+\d{1,2}))\s+[—–-]\s+(\S.{1,90}?)\s*(?:[—–-]\s*\d{1,3}\s+(?:esta[çc][õo]es|quest[õo]es|casos|itens))?$/
const LEGEND_HEAD = /^(temas?( principais| abordados)?|lista de quest[õo]es|quest[õo]es (e|por) temas?|temas? (por|das) quest[õo]es|distribui[çc][ãa]o (dos|por) temas?|[íi]ndice( de quest[õo]es| por temas?)?|sum[áa]rio|conte[úu]do)\s*:?$/i
/** Cabeçalho da tabela da legenda ("Questões Temas principais", "Nº Assunto"). */
const LEGEND_TABLE_HEAD = /^(quest[õo]es|n[º°o.]*|n[úu]mero)\s+(temas?|assuntos?|t[óo]picos?)(\s+\p{L}+)?$/iu

const RANGE = String.raw`\d{1,3}(?:\s*(?:-|–|—|a|at[ée])\s*\d{1,3})?`
const NUMS = String.raw`${RANGE}(?:\s*(?:,|;|\be\b|&)\s*${RANGE})*`
/** "01-04 Incontinência…", "Questões 12, 18 e 38: HPV…", "5 a 7 – Sangramento…" */
const RULE_FORWARD = new RegExp(String.raw`^(?:quest(?:[õo]es|[ãa]o)\s*)?(${NUMS})\s*(?:[:|.)\-–—]\s*)?(\p{L}.{2,})$`, 'iu')
/** "Vaginites: 24-26", "Vaginites – questões 24 a 26" */
const RULE_REVERSE = new RegExp(String.raw`^(\p{L}[^:|]{2,}?)\s*[:|\-–—]\s*(?:quest(?:[õo]es|[ãa]o)\s*)?(${NUMS})$`, 'iu')
const ONLY_NUMS = new RegExp(String.raw`^(?:quest(?:[õo]es|[ãa]o)\s*)?(${NUMS})\s*[:.\-–—]?$`, 'iu')
/** Sumário por PÁGINA ("Vaginites ........ 25") não é legenda por questão. */
const DOT_LEADER = /\.{3,}|…{2,}/
const TRAILING_CONNECTOR = /(\s(e|de|do|da|dos|das|em|no|na|com|ou|para)|[,/\-–])$/i

/** "01-04, 12 e 18" → [1, 2, 3, 4, 12, 18]. Faixas absurdas (invertidas/enormes) invalidam a linha. */
export function expandNumbers(spec: string): number[] | null {
  const out: number[] = []
  for (const part of spec.split(/\s*(?:,|;|\be\b|&)\s*/i).filter(Boolean)) {
    const m = part.match(/^(\d{1,3})(?:\s*(?:-|–|—|a|at[ée])\s*(\d{1,3}))?$/i)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (b < a || b - a > 200) return null
    for (let n = a; n <= b; n++) out.push(n)
  }
  return out.length ? out : null
}

const cleanTopic = (s: string) => {
  const t = s
    .replace(/\s+/g, ' ')
    .replace(/[\s.;,:|\-–—]+$/u, '')
    .trim()
    .slice(0, 80)
  return t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1)
}

interface Line {
  page: number
  text: string
}

function linesOf(pages: { page: number; text: string }[]): Line[] {
  return pages.flatMap((p) =>
    p.text
      .replace(IMAGE_MARK, '')
      .split('\n')
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((text) => ({ page: p.page, text })),
  )
}

/** Linhas repetidas em ≥ 60% das páginas (cabeçalho/rodapé corrido), com números normalizados. */
function runningLines(pages: { page: number; text: string }[]): Set<string> {
  if (pages.length < 3) return new Set()
  const count = new Map<string, number>()
  for (const p of pages) {
    const seen = new Set(linesOf([p]).map((l) => fold(l.text).replace(/\d+/g, '#')))
    for (const k of seen) count.set(k, (count.get(k) ?? 0) + 1)
  }
  return new Set([...count].filter(([, n]) => n >= Math.max(3, pages.length * 0.6)).map(([k]) => k))
}

/** Aceita as páginas do PDF ou o texto completo com marcadores `[[página N]]`. */
export function pagesFromFullText(fullText: string): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = []
  const marks = [...fullText.matchAll(PAGE_MARK)]
  if (!marks.length) return [{ page: 1, text: fullText }]
  marks.forEach((m, i) => out.push({ page: Number(m[1]), text: fullText.slice((m.index ?? 0) + m[0].length, marks[i + 1]?.index ?? fullText.length) }))
  return out
}

export function detectDocumentGuide(pages: { page: number; text: string }[]): DocumentGuide {
  const running = runningLines(pages)
  const isRunning = (t: string) => running.has(fold(t).replace(/\d+/g, '#'))
  const all = linesOf(pages)

  // Trecho antes da 1ª questão (capa, instruções, legenda) — no máximo as 6 primeiras páginas.
  const firstQ = all.findIndex((l) => QUESTION_HEAD.test(l.text))
  const firstPage = pages[0]?.page ?? 1
  const front = (firstQ >= 0 ? all.slice(0, firstQ) : all.filter((l) => l.page < firstPage + 3)).filter((l) => l.page < firstPage + 6)
  const body = front.filter((l) => !isRunning(l.text) && !PAGE_FOOTER.test(l.text))

  const header = [...running].length ? all.find((l) => isRunning(l.text) && !PAGE_FOOTER.test(l.text) && /\p{L}{4}/u.test(l.text))?.text : undefined
  const cover = body.filter((l) => l.page === firstPage).slice(0, 8).map((l) => l.text)
  const titleLines = [...(header ? [header] : []), ...cover].filter((t) => t.length <= 120)
  const title = header ?? cover.find((t) => /\p{L}{4}/u.test(t))

  // Linhas explícitas
  const explicit: DocumentGuide['explicit'] = {}
  for (const l of body) {
    const m = l.text.match(/^(disciplina|mat[ée]ria|especialidade|[áa]rea|curso)\s*:\s*(.{2,80})$/i)
    if (!m) continue
    const value = cleanTopic(m[2])
    if (/^(area|curso)$/.test(fold(m[1]))) explicit.area ??= value
    else explicit.disciplina ??= value
  }

  // Instruções: do título da seção até a legenda / outro título / fim do trecho inicial
  let instructions: string | undefined
  let page: number | undefined
  const iStart = body.findIndex((l) => l.text.length <= 70 && INSTRUCTIONS_HEAD.test(l.text))
  if (iStart >= 0) {
    const parts: string[] = []
    for (const l of body.slice(iStart + 1)) {
      if (LEGEND_HEAD.test(l.text) || LEGEND_TABLE_HEAD.test(l.text) || RULE_FORWARD.test(l.text) || INSTRUCTIONS_HEAD.test(l.text)) break
      parts.push(l.text)
    }
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (text.length >= 20) {
      instructions = text.slice(0, 1500)
      page = body[iStart].page
    }
  }
  const iInline = instructions ? -1 : body.findIndex((l) => INSTRUCTIONS_INLINE.test(l.text))
  if (iInline >= 0) {
    const parts = [body[iInline].text.match(INSTRUCTIONS_INLINE)![6]]
    for (const l of body.slice(iInline + 1)) {
      if (LEGEND_HEAD.test(l.text) || LEGEND_TABLE_HEAD.test(l.text) || THEME_LEGEND.test(l.text) || INSTRUCTIONS_HEAD.test(l.text) || INSTRUCTIONS_INLINE.test(l.text) || /^fontes?\s*:/i.test(l.text)) break
      parts.push(l.text)
    }
    instructions = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500)
    page = body[iInline].page
  }

  // Legenda de temas por código ("1A — Miomas — 17 estações"): exige a contagem em ≥ 2 linhas
  const themeLines = body.filter((l) => THEME_LEGEND.test(l.text) && /\d{1,3}\s+(esta[çc][õo]es|quest[õo]es|casos|itens)\s*$/i.test(l.text))
  const themes = themeLines.length >= 2 ? themeLines.map((l) => l.text.match(THEME_LEGEND)!).map((m) => ({ code: m[1], name: cleanTopic(m[2]) })) : []
  if (themes.length) page ??= themeLines[0].page

  // Legenda questão → tema
  const topics: TopicRule[] = []
  let last: TopicRule | null = null
  let pendingNums: string | null = null
  for (const l of body) {
    const t = l.text
    if (DOT_LEADER.test(t) || LEGEND_HEAD.test(t) || LEGEND_TABLE_HEAD.test(t) || (themes.length && THEME_LEGEND.test(t))) {
      last = null
      pendingNums = null
      continue
    }
    const fwd = t.match(RULE_FORWARD)
    const rev = fwd ? null : t.match(RULE_REVERSE)
    const only = fwd || rev ? null : t.match(ONLY_NUMS)
    const spec = fwd?.[1] ?? rev?.[2]
    const topic = fwd?.[2] ?? rev?.[1]
    if (spec && topic) {
      const numbers = expandNumbers(spec)
      if (numbers) {
        last = { numbers, assunto: cleanTopic(topic), source: spec.replace(/\s+/g, '') }
        topics.push(last)
        page ??= l.page
        pendingNums = null
        continue
      }
    }
    if (only && expandNumbers(only[1])) {
      // tabela extraída em colunas: os números numa linha, o tema na seguinte
      pendingNums = only[1]
      last = null
      continue
    }
    if (pendingNums && /^\p{L}/u.test(t)) {
      last = { numbers: expandNumbers(pendingNums)!, assunto: cleanTopic(t), source: pendingNums.replace(/\s+/g, '') }
      topics.push(last)
      page ??= l.page
      pendingNums = null
      continue
    }
    // continuação do tema quebrado em duas linhas ("…anormal e" + "endométrio")
    if (last && /^\p{L}/u.test(t) && t.length <= 60 && (/^\p{Ll}/u.test(t) || TRAILING_CONNECTOR.test(last.assunto))) {
      last.assunto = cleanTopic(`${last.assunto} ${t}`)
      continue
    }
    last = null
    pendingNums = null
  }
  // Uma linha solta "1 Introdução" não é legenda: exige ≥ 2 regras e nenhum número repetido em temas diferentes.
  const seen = new Set<number>()
  const consistent = topics.every((r) => r.numbers.every((n) => (seen.has(n) ? false : (seen.add(n), true))))
  const legend = topics.length >= 2 && consistent ? topics : []

  return {
    title,
    titleLines,
    explicit,
    instructions,
    topics: legend,
    ...(themes.length ? { themes } : {}),
    page: legend.length || instructions || themes.length ? page : undefined,
    hasFrontMatter: firstQ > 0 && (!!instructions || legend.length > 0 || themes.length > 0),
  }
}

/** Tema da legenda por código que corresponde ao título de seção da questão ("Miomas", "SUA (aguda…)"). */
export function themeForSection(guide: DocumentGuide | undefined, section: string | undefined): { assunto: string; source: string } | undefined {
  if (!guide?.themes?.length || !section) return undefined
  const s = fold(section)
  const hit = guide.themes.find((t) => fold(t.name) === s) ?? guide.themes.find((t) => s.startsWith(fold(t.name)) || fold(t.name).startsWith(s))
  return hit ? { assunto: hit.name, source: `tema ${hit.code}` } : undefined
}

/** Tema que a legenda indica para a questão nº `n`. */
export function topicForQuestion(guide: DocumentGuide, n: number | null | undefined): TopicRule | undefined {
  if (n == null) return undefined
  return guide.topics.find((r) => r.numbers.includes(n))
}

/** Taxonomia do prompt ("Medicina > Ginecologia" por linha) → entradas. */
export function parseTaxonomyLines(taxonomy: string): TaxonomyEntry[] {
  return taxonomy
    .split('\n')
    .map((l) => l.split('>').map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([area, discipline]) => ({ area, discipline }))
}

const wordIn = (needle: string, hay: string) => new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(hay)

/**
 * Área e disciplina que o documento indica, casadas com a taxonomia existente (mesma grafia).
 * Prioridade: "Disciplina:" explícita → disciplina citada no título/capa (a 1ª que aparece).
 * Disciplina presente em mais de uma área: usa a área citada no documento; se nenhuma, fica sem área
 * (a IA decide, com a disciplina como pista).
 */
export function resolveGuideTaxonomy(guide: DocumentGuide, entries: TaxonomyEntry[]): { area?: string; disciplina?: string } {
  const titleText = fold(guide.titleLines.join(' \n '))
  const areaHint = guide.explicit.area ? fold(guide.explicit.area) : undefined
  let disciplina: string | undefined
  if (guide.explicit.disciplina) {
    const want = fold(guide.explicit.disciplina)
    disciplina = entries.find((e) => fold(e.discipline) === want)?.discipline ?? guide.explicit.disciplina
  } else {
    let best: { name: string; at: number } | undefined
    for (const e of entries) {
      const name = fold(e.discipline)
      if (name.length < 4 || !wordIn(name, titleText)) continue
      const at = titleText.search(new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      if (!best || at < best.at || (at === best.at && name.length > fold(best.name).length)) best = { name: e.discipline, at }
    }
    disciplina = best?.name
  }
  if (!disciplina) {
    const area = areaHint ? entries.find((e) => fold(e.area) === areaHint)?.area ?? guide.explicit.area : undefined
    return { area }
  }
  const areas = [...new Set(entries.filter((e) => fold(e.discipline) === fold(disciplina!)).map((e) => e.area))]
  const named = areas.find((a) => (areaHint ? fold(a) === areaHint : wordIn(fold(a), titleText)))
  const area = named ?? (areas.length === 1 ? areas[0] : guide.explicit.area)
  return { area, disciplina }
}

/** Número da questão a partir do rótulo ("QUESTÃO 07" → 7, "Questão 1.2" → 1, "12)" → 12). */
export function questionNumber(label: string | null | undefined): number | null {
  if (!label) return null
  const m = label.match(/QUEST[ÃA]O\s*(\d{1,3})/i) ?? label.trim().match(/^(\d{1,3})(?:\s*[).]|$)/)
  return m ? Number(m[1]) : null
}

/**
 * Números das questões na ordem do documento. Em material com cabeçalhos "QUESTÃO N", um bloco
 * numerado "1)"/"2)" logo depois é PARTE da questão anterior (ex.: "Paciente A/B/C/D" da questão 35):
 * herda o número dela, em vez de cair no tema da questão 1.
 */
export function numberQuestions(labels: (string | null | undefined)[]): (number | null)[] {
  const headed = labels.filter((l) => l && /QUEST[ÃA]O/i.test(l)).length >= 3
  let lastHeaded: number | null = null
  return labels.map((l) => {
    if (l && /QUEST[ÃA]O/i.test(l)) return (lastHeaded = questionNumber(l))
    if (headed) return lastHeaded
    return questionNumber(l)
  })
}

/** Resumo do guia para o prompt de classificação (vai DENTRO do wrapUntrusted). */
export function guideForPrompt(guide: DocumentGuide, resolved: { area?: string; disciplina?: string }): string {
  const parts: string[] = []
  if (guide.title) parts.push(`Título: ${guide.title}`)
  if (resolved.disciplina) parts.push(`Disciplina indicada: ${resolved.area ? `${resolved.area} › ` : ''}${resolved.disciplina}`)
  if (guide.topics.length) parts.push(`Temas por questão: ${guide.topics.map((r) => `${r.source} = ${r.assunto}`).join('; ')}`)
  if (guide.instructions) parts.push(`Instruções do documento: ${guide.instructions.slice(0, 600)}`)
  return parts.join('\n')
}
