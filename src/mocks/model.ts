import type { Id, Question, QuestionItem } from '@shared/domain'
import { itemLabelText } from '@shared/item-label'

/** Tipos e helpers do protótipo (separados do store para o fast refresh do Vite). */

export const norm = (s: string) => s.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '')

/** Card da tela de revisão da importação (Área › Disciplina · Assunto). */
export interface ImportCard {
  id: Id
  area: string
  discipline: string
  topic: string
  description: string
  questionIds: Id[]
}

/** Questão em rascunho (antes de ser vinculada a um card e salva). */
export type DraftQuestion = Omit<Question, 'ownerId' | 'groupId' | 'areaId' | 'disciplineId' | 'topic' | 'createdAt'>

export { hasValidAlternatives, isEligible, presentAs } from '@shared/simulado'

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

export const emptyItem = (label?: string): QuestionItem => ({
  id: uid('it'),
  label,
  prompt: '',
  type: 'discursiva',
  expectedAnswer: '',
  keyPoints: [],
})

/** Rótulo de exibição da pergunta: "a)", "1)" ou "Pergunta" (única). */
export const itemLabel = (it: Pick<QuestionItem, 'label'>, i?: number) => itemLabelText(it.label, i)
