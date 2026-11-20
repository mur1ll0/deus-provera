/**
 * Parser do GABARITO DE REFERÊNCIA (Markdown) — formato definido em
 * samples/private/extracao/INSTRUCOES.md e docs/10-avaliacao-importador.md.
 *
 *   ## U3-008 · QUESTÃO 8 · p. 7
 *   - Seção / Área / Disciplina / Assunto / Dificuldade / Imagem
 *   ### Enunciado
 *   ### Pergunta a | ### Pergunta única
 *   #### Tipo original | #### Resposta esperada | #### Pontos-chave | #### Alternativas
 */
import type { ImportFile, ImportQuestion } from '../shared/schemas/import'

export interface GoldAlternative {
  text: string
  correct: boolean
  explanation?: string
}

export interface GoldItem {
  label?: string
  prompt: string
  type: 'objetiva' | 'discursiva'
  expectedAnswer?: string
  keyPoints: string[]
  alternatives: GoldAlternative[]
}

export interface GoldQuestion {
  id: string
  doc: string
  sourceLabel: string
  page: number
  section?: string
  area: string
  discipline: string
  topic?: string
  difficulty?: 'facil' | 'media' | 'dificil'
  image?: string
  stem: string
  items: GoldItem[]
}

const fold = (s: string) => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').trim()
const NO_ANSWER = /^_?\(?\s*n[ãa]o consta no pdf\s*\)?_?$/i

export function parseGabarito(md: string, fallbackDoc = ''): GoldQuestion[] {
  const out: GoldQuestion[] = []
  let doc = fallbackDoc
  let q: GoldQuestion | null = null
  let item: GoldItem | null = null
  let section: 'meta' | 'stem' | 'prompt' | 'tipo' | 'resposta' | 'pontos' | 'alts' | null = null
  let buf: string[] = []

  const flush = () => {
    const text = buf.join('\n').trim()
    buf = []
    if (!q) return
    if (section === 'stem') q.stem = text
    else if (item && section === 'prompt') item.prompt = text
    else if (item && section === 'tipo') item.type = /objetiva/i.test(text) ? 'objetiva' : 'discursiva'
    else if (item && section === 'resposta') item.expectedAnswer = text && !NO_ANSWER.test(text) ? text : undefined
    else if (item && section === 'pontos')
      item.keyPoints = text
        .split('\n')
        .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean)
    else if (item && section === 'alts') {
      item.alternatives = text
        .split('\n')
        .map((l) => l.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/))
        .filter(Boolean)
        .map((m) => {
          const [t, why] = m![2].split(/\s+—\s+Por que está errada:\s*/i)
          return { text: t.trim(), correct: m![1].toLowerCase() === 'x', explanation: why?.trim() || undefined }
        })
    }
  }

  for (const line of md.split(/\r?\n/)) {
    const docM = line.match(/^<!--\s*doc:\s*(.+?)\s*(?:·|-->)/)
    if (docM) {
      doc = docM[1].trim()
      continue
    }
    const qM = line.match(/^##\s+(U\d-\d{3})\s*·\s*(.*?)\s*·\s*p\.\s*(\d+)/)
    if (qM) {
      flush()
      section = 'meta'
      item = null
      q = { id: qM[1], doc, sourceLabel: qM[2].trim(), page: Number(qM[3]), area: 'Medicina', discipline: '', stem: '', items: [] }
      out.push(q)
      continue
    }
    if (!q) continue
    const h3 = line.match(/^###\s+(.*)$/)
    if (h3 && !line.startsWith('####')) {
      flush()
      const title = fold(h3[1])
      if (title.startsWith('enunciado')) section = 'stem'
      else if (title.startsWith('pergunta')) {
        const label = h3[1].replace(/^pergunta\s*/i, '').trim()
        item = { label: /^[úu]nica$/i.test(label) || !label ? undefined : label.toLowerCase(), prompt: '', type: 'discursiva', keyPoints: [], alternatives: [] }
        q.items.push(item)
        section = 'prompt'
      }
      continue
    }
    const h4 = line.match(/^####\s+(.*)$/)
    if (h4) {
      flush()
      const t = fold(h4[1])
      section = t.startsWith('tipo') ? 'tipo' : t.startsWith('resposta') ? 'resposta' : t.startsWith('pontos') ? 'pontos' : t.startsWith('alternativas') ? 'alts' : null
      continue
    }
    if (section === 'meta') {
      const m = line.match(/^\s*-\s*([^:]+):\s*(.*)$/)
      if (m) {
        const key = fold(m[1])
        const val = m[2].trim()
        if (key === 'secao') q.section = val
        else if (key === 'area') q.area = val
        else if (key === 'disciplina') q.discipline = val
        else if (key === 'assunto') q.topic = val
        else if (key === 'dificuldade') q.difficulty = (['facil', 'media', 'dificil'].includes(fold(val)) ? fold(val) : 'media') as GoldQuestion['difficulty']
        else if (key === 'imagem') q.image = /^n[ãa]o$/i.test(val) ? undefined : val
      }
      continue
    }
    if (line.startsWith('<!--')) continue
    buf.push(line)
  }
  flush()
  return out
}

/** Título de seção → assunto amplo: "CA DE MAMA / Prof Simone/ Alberto" → "Ca de mama". */
function sectionTopic(section: string | undefined): string | undefined {
  if (!section) return undefined
  // "QUESTÕES … UNIDADE / PROLAPSO GENITAL / ASSUNTO: ANDREA" → segmentos até "ASSUNTO"/"Prof" → o último
  const segs: string[] = []
  for (const s of section.split(/\s+\/\s*|\s*·\s*|\s+—\s+/)) {
    const assunto = s.match(/^assunto\s*:\s*(.+)$/i)
    if (assunto && !segs.length) segs.push(assunto[1].trim()) // "ASSUNTO: CA de ovário / Prof Alberto"
    if (/^(assunto|prof)/i.test(s)) break
    if (s.trim()) segs.push(s.trim())
  }
  const head = segs.at(-1)
  if (!head) return undefined
  const ACRONYMS = new Set(['CA', 'SOP', 'HPV', 'DIPA', 'NIC', 'IU', 'IUE', 'IST', 'DST', 'HIV', 'TH', 'II', 'III'])
  const words = head.split(/\s+/).map((w, i) => {
    if (ACRONYMS.has(w.toUpperCase().replace(/[^A-Z]/g, '')) && w === w.toUpperCase()) return w
    const low = w.toLocaleLowerCase('pt-BR')
    return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low
  })
  return words.join(' ')
}

/** Gabarito → formato de importação v2. Perguntas sem resposta são omitidas (o contrato exige resposta). */
export function goldToImportFile(gold: GoldQuestion[], arquivo: string): { file: ImportFile; skippedItems: number; skippedQuestions: number } {
  let skippedItems = 0
  let skippedQuestions = 0
  const questoes: ImportQuestion[] = []
  for (const g of gold) {
    const perguntas = g.items
      .filter((it) => {
        const ok = !!it.expectedAnswer || it.alternatives.some((a) => a.correct)
        if (!ok) skippedItems++
        return ok
      })
      .map((it) => ({
        rotulo: it.label ?? null,
        texto: g.items.length > 1 ? it.prompt || `(pergunta ${it.label ?? ''})` : it.prompt,
        tipo: it.type === 'objetiva' && it.alternatives.length >= 2 ? ('objetiva' as const) : ('discursiva' as const),
        resposta_esperada: it.expectedAnswer ?? (it.type === 'objetiva' ? null : (it.alternatives.find((a) => a.correct)?.text ?? null)),
        pontos_chave: it.keyPoints.length ? it.keyPoints.map((k) => k.slice(0, 300)) : null,
        alternativas: it.alternatives.length >= 2 ? it.alternatives.map((a) => ({ texto: a.text.slice(0, 1500), correta: a.correct, explicacao: a.explanation ?? null, gerada_por_ia: it.type !== 'objetiva' })) : null,
      }))
    if (!perguntas.length) {
      skippedQuestions++
      continue
    }
    questoes.push({
      area: g.area || 'Medicina',
      disciplina: g.discipline || 'Ginecologia',
      // assunto AMPLO (seção da apostila) para agrupar os cards em vez de um card por questão
      assunto: sectionTopic(g.section) ?? g.topic ?? null,
      rotulo: g.sourceLabel.slice(0, 40),
      enunciado: g.stem || '(enunciado não identificado)',
      perguntas,
      dificuldade: g.difficulty ?? 'media',
      tem_imagem: !!g.image,
      descricao_imagem: g.image?.slice(0, 2000) ?? null,
      pagina: g.page,
    })
  }
  return { file: { versao: '2.0', origem: { arquivo }, questoes }, skippedItems, skippedQuestions }
}
