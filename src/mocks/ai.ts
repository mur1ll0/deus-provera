import type { Alternative, QuestionItem } from '@shared/domain'

/**
 * IA SIMULADA para o protótipo. Mesmas assinaturas que o cliente da API real
 * (src/lib/api.ts no produto) — trocar a implementação não muda as telas.
 *
 * Produto real: server/ai/graphs/* via OpenRouter (modelos gratuitos + fallback).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const norm = (s: string) => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '')

export interface Classification {
  area: string
  discipline: string
  topic: string
  confidence: number
}

const RULES: { re: RegExp; c: Omit<Classification, 'confidence'> }[] = [
  { re: /prolapso|pop-?q|colpocleise|colporrafia|baden|histeropexia|culdoplastia/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Prolapso genital' } },
  { re: /incontin|sling|tvt|tot\b|urodin|bexiga hiperativa|enurese|urge|burch/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Incontinência urinária' } },
  { re: /\bhpv\b|\bnic\b|citologia|colposcopia|coniza|colo (do )?ut|colo uterino|wertheim|lsil|hsil/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'HPV e câncer do colo' } },
  { re: /mama|mamograf|brca|her2|mastect|linfonodo sentinela/, c: { area: 'Medicina', discipline: 'Mastologia', topic: 'Câncer de mama' } },
  { re: /mioma|miomatose|leiomioma/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Miomatose uterina' } },
  { re: /endometriose|adenomiose|endometrioma/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Endometriose' } },
  { re: /climat|menopausa|terapia hormonal|fogach/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Climatério' } },
  { re: /ovarios policisticos|\bsop\b|hirsutismo/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'SOP' } },
  { re: /ca de ovario|cancer de ovario|neoplasia(s)? ovarian|tumor(es)? de ovario|teratoma|disgerminoma/, c: { area: 'Medicina', discipline: 'Oncologia ginecológica', topic: 'Câncer de ovário' } },
  { re: /sexualidade|desejo sexual|libido|vaginismo|disfun[cç][aã]o sexual|orgasmo|basson/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Sexualidade' } },
  { re: /\bdipa\b|doenca inflamatoria pelvica|salpingite|abscesso tubo/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'DIPA' } },
  { re: /infertilidade|histeroscopia|antimulleriano|espermograma/, c: { area: 'Medicina', discipline: 'Ginecologia', topic: 'Infertilidade e histeroscopia' } },
  { re: /endometrio|ovario|ovarian|anexial|ca-?125/, c: { area: 'Medicina', discipline: 'Oncologia ginecológica', topic: 'Oncologia ginecológica' } },
  { re: /integral|derivada|limite|primitiva/, c: { area: 'Matemática', discipline: 'Cálculo', topic: 'Integrais' } },
  { re: /piaget|vygotsky|erikson|freud/, c: { area: 'Psicologia', discipline: 'Psicologia do Desenvolvimento', topic: 'Teorias do desenvolvimento' } },
]

/**
 * Classificação simulada (no produto: LLM). Usa primeiro o título da seção + enunciado — o texto das
 * respostas mistura muitos temas e confunde a heurística — e só depois o texto completo.
 */
export function classifyQuestion(section: string | undefined, stem: string, fullText: string): Classification {
  for (const text of [section ?? '', stem, fullText]) {
    const c = classifyText(text)
    if (c.confidence >= 0.5) return c
  }
  return classifyText(fullText)
}

export function classifyText(text: string): Classification {
  const t = norm(text)
  for (const r of RULES) if (r.re.test(t)) return { ...r.c, confidence: 0.86 }
  const medical = /paciente|mulher|anos|exame|conduta|diagnost/.test(t)
  return medical
    ? { area: 'Medicina', discipline: 'Ginecologia', topic: 'Outros (revisar)', confidence: 0.42 }
    : { area: 'Geral', discipline: 'Sem disciplina', topic: 'Outros (revisar)', confidence: 0.3 }
}

/** Gera alternativas (1 correta + 4 distratores) para UMA pergunta a partir da resposta esperada. */
export async function aiGenerateDistractors(q: Pick<QuestionItem, 'expectedAnswer' | 'keyPoints' | 'prompt'>): Promise<Alternative[]> {
  await sleep(900)
  const answer = q.expectedAnswer ?? ''
  const firstSentence = answer.split(/(?<=[.!?])\s/)[0] ?? answer
  const correct = firstSentence.length > 220 ? `${firstSentence.slice(0, 217)}…` : firstSentence
  const kp = q.keyPoints ?? []
  const distractors = [
    'Conduta expectante, sem necessidade de investigação ou tratamento adicional neste momento.',
    kp[0] ? `Contraindicar "${kp[0].toLowerCase()}" e optar por abordagem radical imediata.` : 'Tratamento radical imediato, sem avaliação complementar.',
    'Repetir os mesmos exames em 12 meses antes de qualquer decisão terapêutica.',
    kp[1] ? `Priorizar exclusivamente "${kp[1].toLowerCase()}", dispensando os demais cuidados.` : 'Encaminhar sem conduta, pois o quadro não exige intervenção.',
  ]
  const mk = (text: string, correctFlag: boolean, explanation: string): Alternative => ({
    id: `alt-${Math.random().toString(36).slice(2, 8)}`,
    text,
    correct: correctFlag,
    explanation,
    source: 'ia',
  })
  return [
    mk(correct || 'Resposta conforme o gabarito', true, 'Resume os pontos-chave da resposta esperada.'),
    ...distractors.map((d) => mk(d, false, 'Distrator plausível gerado a partir da resposta esperada (demo).')),
  ].sort(() => Math.random() - 0.5)
}

export interface AiExplanation {
  hint: string
  perAlternative: { id: string; verdict: 'correta' | 'incorreta'; why: string }[]
  summary: string
  model: string
}

/** Explica UMA pergunta (dica, por que cada alternativa está certa/errada, resumo). */
export async function aiExplain(q: Pick<QuestionItem, 'keyPoints' | 'alternatives' | 'expectedAnswer'>, topic?: string): Promise<AiExplanation> {
  await sleep(1100)
  const key = q.keyPoints?.[0] ?? topic ?? 'o conceito central do enunciado'
  return {
    hint: `Releia o enunciado procurando o dado decisivo. Pense em: ${key}.`,
    perAlternative: (q.alternatives ?? []).map((a) => ({
      id: a.id,
      verdict: a.correct ? 'correta' : 'incorreta',
      why:
        a.explanation ??
        (a.correct
          ? 'Atende exatamente ao que o enunciado pede, de acordo com a resposta de referência.'
          : 'Não corresponde ao dado-chave do enunciado; é um distrator comum nesse tema.'),
    })),
    summary: q.expectedAnswer ?? (q.alternatives ?? []).find((a) => a.correct)?.explanation ?? 'Revise o tema no seu material de referência.',
    model: 'demo · nvidia/nemotron-3-ultra-550b-a55b:free (simulado)',
  }
}

/** Correção de discursiva por pontos-chave (heurística local; no produto a IA corrige e esta função é o fallback). */
export function gradeByKeyPoints(answer: string, keyPoints: string[]): { matched: boolean[]; score: number } {
  const a = norm(answer)
  const matched = keyPoints.map((kp) => {
    const words = norm(kp).split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
    if (!words.length) return false
    const hits = words.filter((w) => a.includes(w.slice(0, Math.max(4, w.length - 2)))).length
    return hits / words.length >= 0.5
  })
  const score = keyPoints.length ? matched.filter(Boolean).length / keyPoints.length : 0
  return { matched, score }
}

export async function aiGradeDiscursive(answer: string, keyPoints: string[]) {
  await sleep(1000)
  const r = gradeByKeyPoints(answer, keyPoints)
  return {
    ...r,
    feedback:
      r.score >= 0.75
        ? 'Boa resposta: cobriu a maior parte dos pontos exigidos.'
        : r.score >= 0.4
          ? 'Resposta parcial: faltaram pontos importantes (veja o checklist).'
          : 'Resposta insuficiente: revise a resposta esperada e o tema.',
  }
}

export const PIPELINE_STEPS = [
  { id: 'guard', label: 'Guardrail de segurança', detail: 'Normaliza texto e remove tentativas de injeção' },
  { id: 'segment', label: 'Segmentação', detail: 'Separa questões, enunciados e perguntas (determinístico)' },
  { id: 'structure', label: 'Estruturação com IA', detail: 'Enunciado, perguntas, respostas e pontos-chave (JSON validado)' },
  { id: 'classify', label: 'Categorização', detail: 'Área › Disciplina › Assunto + resumo' },
  { id: 'distractors', label: 'Alternativas incorretas', detail: 'Gera distratores para discursivas (opcional)' },
  { id: 'validate', label: 'Validação final', detail: 'Schema, duplicatas e consistência' },
] as const

export async function runMockPipeline(onStep: (index: number) => void) {
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    onStep(i)
    await sleep(i === 2 ? 1400 : 650)
  }
  onStep(PIPELINE_STEPS.length)
}
