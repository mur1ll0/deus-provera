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
 *  - início de questão: "QUESTÃO 8." / "Questão 2 -" / "QUESTÃO 1.1" / "1) Mulher de 38 anos…"
 *  - seções: linhas em CAIXA ALTA ("CA DE MAMA") e "ASSUNTO: …"
 *  - perguntas: "a." / "b)" no início da linha, em sequência (a, b, c…)
 *  - fim da pergunta: "?" (+ "Justifique." / "Explique." na sequência) ou comando terminado em ":"/"."
 */

export interface SegmentedItem {
  /** "a", "b"… (ausente na pergunta única) */
  label?: string
  /** Texto da pergunta ('' na pergunta única) */
  prompt: string
  answer?: string
}

export interface SegmentedQuestion {
  key: string
  sourceLabel?: string
  section?: string
  stem: string
  items: SegmentedItem[]
  page?: number
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
}

const CASE_START = /^(mulher|paciente|homem|gestante|primigesta|adolescente|jovem|crian[cç]a|uma? (mulher|paciente|jovem)|[A-ZÁÉÍÓÚ][a-záéíóúãõç]+,?\s+\d{1,2}\s*anos|[A-Z]{2,4},?\s+\d{1,2}\s*anos|[A-ZÁÉÍÓÚ][a-záéíóúãõç]+\s+tem\s+\d{1,2}\s*anos)/i

function findMarks(text: string): Mark[] {
  const marks: Mark[] = []
  for (const m of text.matchAll(/QUEST[ÃA]O\s*(\d{1,3}(?:\.\d{1,2})?)\s*[.:)\-–]?/gi)) {
    marks.push({ index: m.index ?? 0, kind: 'question', label: `QUESTÃO ${m[1]}` })
  }
  // Numeração simples ("1) Mulher de 38 anos…", "4. Para o caso acima, quais…?", "10a. Mulher 23a…")
  // só quando parece início de questão: começa como caso clínico, ou a 1ª linha é uma pergunta/comando.
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(\d{1,2}[a-z]?)\s*[).]\s+(?=\S)/g)) {
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

function parseBlock(body: string): { stem: string; items: SegmentedItem[] } {
  // Perguntas em sequência a, b, c… no início da linha
  const subs: { letter: string; index: number; len: number }[] = []
  let expected = 'a'
  for (const m of body.matchAll(/(?:^|\n)[ \t]*([a-h])\s*[.)][ \t]+/g)) {
    if (m[1] === expected) {
      subs.push({ letter: m[1], index: m.index ?? 0, len: m[0].length })
      expected = String.fromCharCode(expected.charCodeAt(0) + 1)
    }
  }
  if (subs.length >= 1 && (subs.length >= 2 || subs[0].index > 40)) {
    const stem = reflow(tidy(body.slice(0, subs[0].index)))
    const items = subs.map((s, i) => {
      const chunk = tidy(body.slice(s.index + s.len, subs[i + 1]?.index ?? body.length))
      const { prompt, answer } = splitPromptAnswer(chunk)
      return { label: s.letter, prompt: reflow(prompt), answer: answer && reflow(answer) }
    })
    return { stem, items }
  }
  // Pergunta única: o enunciado já contém o comando
  const { prompt, answer } = splitPromptAnswer(tidy(body))
  return { stem: reflow(prompt), items: [{ prompt: '', answer: answer && reflow(answer) }] }
}

export function segmentQuestions(fullText: string): SegmentedQuestion[] {
  const marks = findMarks(fullText)
  const out: SegmentedQuestion[] = []
  let section: string | undefined
  let n = 0

  const pushBlock = (start: number, end: number, label?: string) => {
    const raw = fullText.slice(start, end)
    const body = raw.replace(/^\s*(QUEST[ÃA]O\s*\d{1,3}(?:\.\d{1,2})?\s*[.:)\-–]?|\d{1,2}\s*[).])\s*/i, '')
    if (tidy(body).replace(/\s/g, '').length < 40) return
    const { stem, items } = parseBlock(body)
    if (!stem && !items.length) return
    out.push({ key: `Q${++n}`, sourceLabel: label, section, stem, items, page: pageAt(fullText, start) })
  }

  // Texto antes da primeira marca (ex.: comando comum de uma seção) só vira questão se for longo
  if (marks.length && tidy(fullText.slice(0, marks[0].index)).length > 400) pushBlock(0, marks[0].index)

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    const end = marks[i + 1]?.index ?? fullText.length
    if (m.kind === 'section') {
      section = m.section
      // texto entre o título da seção e a próxima questão: questão sem rótulo (se for longo)
      // pula o título e a linha "ASSUNTO…/Prof…"
      const lineEnd = fullText.indexOf('\n', fullText.indexOf('\n', m.index) + 1)
      const afterTitle = lineEnd >= 0 && lineEnd < end ? lineEnd : end
      if (tidy(fullText.slice(afterTitle, end)).length > 400) pushBlock(afterTitle, end)
      continue
    }
    pushBlock(m.index, end, m.label)
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
