import { z } from 'zod'
import { optText, questionContentInput, text } from './question'

/**
 * Corpo de `POST /api/imports/:id/commit` (spec 002 › Confirmação; T024/T025/T048).
 * Cards da revisão (Área › Disciplina · Assunto) com as questões já no modelo v2 (enunciado + perguntas).
 * Mesmas regras do editor e de `/api/questions`; usado no cliente (pré-validação) e no servidor.
 */

export const IMPORT_COMMIT_LIMITS = { cards: 200, questionsPerCard: 500, questions: 1000 } as const

/** Nomes do card "órfão" que a revisão cria quando a IA não classificou a questão. */
export const UNCLASSIFIED = { area: 'Sem área', discipline: 'Sem disciplina' } as const

const unclassified = (s: string, v: string) => s.localeCompare(v, 'pt-BR', { sensitivity: 'base' }) === 0

export const importCardInput = z.object({
  area: text(80)
    .pipe(z.string().min(2, 'Informe a área do card.'))
    .refine((s) => !unclassified(s, UNCLASSIFIED.area), 'Escolha a área do card "Revisar categoria".'),
  discipline: text(80)
    .pipe(z.string().min(2, 'Informe a disciplina do card.'))
    .refine((s) => !unclassified(s, UNCLASSIFIED.discipline), 'Escolha a disciplina do card "Revisar categoria".'),
  topic: optText(120),
  description: optText(1_000),
  questions: z.array(questionContentInput).min(1, 'Card sem questões.').max(IMPORT_COMMIT_LIMITS.questionsPerCard),
})

export const importCommitInput = z
  .object({ cards: z.array(importCardInput).min(1, 'Nada para salvar.').max(IMPORT_COMMIT_LIMITS.cards) })
  .refine((b) => b.cards.reduce((a, c) => a + c.questions.length, 0) <= IMPORT_COMMIT_LIMITS.questions, {
    error: `No máximo ${IMPORT_COMMIT_LIMITS.questions} questões por importação.`,
  })

export type ImportCommitInput = z.input<typeof importCommitInput>
export type ImportCommitParsed = z.output<typeof importCommitInput>

/** Problema de validação apontando a questão (`cards[i].questions[j]`) ou o card (`cards[i]`). */
export interface CommitIssue {
  card: number
  question?: number
  message: string
}

/** Nome do campo (último trecho do caminho) para as mensagens padrão do zod. */
const FIELD_NAMES: Record<string, string> = {
  area: 'Área',
  discipline: 'Disciplina',
  topic: 'Assunto',
  description: 'Descrição',
  sourceLabel: 'Rótulo da questão',
  stem: 'Enunciado',
  items: 'Perguntas',
  label: 'Rótulo',
  prompt: 'Texto',
  expectedAnswer: 'Resposta esperada',
  keyPoints: 'Pontos de acerto',
  alternatives: 'Alternativas',
  text: 'Texto da alternativa',
  explanation: 'Explicação',
}

/**
 * Mensagem em pt-BR para os erros padrão do zod (as mensagens próprias dos schemas já vêm em pt-BR).
 * Ex.: "Pergunta 2 · Rótulo: no máximo 20 caracteres."
 */
function issueMessage(i: z.core.$ZodIssue): string {
  if (!/^(Too (big|small)|Invalid)\b/.test(i.message)) return i.message
  const keys = i.path.filter((p): p is string => typeof p === 'string')
  const field = [...keys].reverse().map((k) => FIELD_NAMES[k]).find(Boolean)
  const at = i.path.indexOf('items')
  const item = at >= 0 && typeof i.path[at + 1] === 'number' ? `Pergunta ${(i.path[at + 1] as number) + 1}` : undefined
  const where = [item, field].filter(Boolean).join(' · ')
  let what = 'valor inválido.'
  if (i.code === 'too_big') what = i.origin === 'string' ? `no máximo ${i.maximum} caracteres.` : `no máximo ${i.maximum} itens.`
  else if (i.code === 'too_small') what = i.origin === 'string' ? `no mínimo ${i.minimum} caracteres.` : `no mínimo ${i.minimum} itens.`
  return where ? `${where}: ${what}` : what.charAt(0).toUpperCase() + what.slice(1)
}

/** zod → lista por card/questão (o cliente mapeia de volta para os rascunhos da revisão). */
export function commitIssues(error: z.ZodError): CommitIssue[] {
  const seen = new Set<string>()
  return error.issues.flatMap((i) => {
    const [, card, , question] = i.path
    const issue: CommitIssue = {
      card: typeof card === 'number' ? card : -1,
      question: i.path[2] === 'questions' && typeof question === 'number' ? question : undefined,
      message: issueMessage(i),
    }
    // O mesmo problema repetido na mesma questão (ex.: várias perguntas) aparece uma vez só.
    const key = `${issue.card}|${issue.question ?? ''}|${issue.message}`
    if (seen.has(key)) return []
    seen.add(key)
    return [issue]
  })
}

export interface CommitResult {
  saved: number
  duplicates: number
  groups: { id: string; area: string; discipline: string; topic: string | null; count: number }[]
}

/* ---------------------- Conversões usadas pelo cliente (e pelos testes) ---------------------- */

/** Questão da revisão no formato do domínio (DraftQuestion do cliente). */
export interface DraftLike {
  sourceLabel?: string
  stem: string
  items: {
    label?: string
    prompt: string
    type: 'objetiva' | 'discursiva'
    expectedAnswer?: string
    keyPoints?: string[]
    alternatives?: { text: string; correct: boolean; explanation?: string; source: 'usuario' | 'ia' }[]
  }[]
  difficulty: 'facil' | 'media' | 'dificil'
  visibility: 'privada' | 'publica'
  hasImage?: boolean
  imageDescription?: string
  flags?: string[]
}

export interface CardLike {
  area: string
  discipline: string
  topic?: string
  description?: string
  questionIds: string[]
}

/**
 * Cards + rascunhos da revisão → corpo do commit. `refs[i][j]` = id do rascunho da questão j do card i
 * (para o cliente apontar os erros do servidor na questão certa). Cards vazios são omitidos.
 */
export function toCommitInput(cards: CardLike[], drafts: Record<string, DraftLike>): { body: ImportCommitInput; refs: string[][] } {
  const refs: string[][] = []
  const out: ImportCommitInput['cards'] = []
  for (const c of cards) {
    const ids = c.questionIds.filter((id) => drafts[id])
    if (!ids.length) continue
    refs.push(ids)
    out.push({
      area: c.area,
      discipline: c.discipline,
      topic: c.topic || undefined,
      description: c.description || undefined,
      questions: ids.map((id) => {
        const d = drafts[id]
        return {
          sourceLabel: d.sourceLabel,
          stem: d.stem,
          items: d.items.map((it) => ({
            label: it.label,
            prompt: it.prompt,
            type: it.type,
            expectedAnswer: it.expectedAnswer,
            keyPoints: it.keyPoints ?? [],
            alternatives: (it.alternatives ?? []).map((a) => ({ text: a.text, correct: a.correct, explanation: a.explanation, source: a.source })),
          })),
          difficulty: d.difficulty,
          visibility: d.visibility,
          hasImage: d.hasImage ?? false,
          imageDescription: d.imageDescription,
          flags: d.flags ?? [],
        }
      }),
    })
  }
  return { body: { cards: out }, refs }
}
