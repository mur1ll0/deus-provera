import type { QuestionItem } from './domain'
import { hasValidAlternatives } from './simulado'

/**
 * Formatos que faltam numa questão (spec 002 › FR-R8): cada pergunta pode ser respondida
 * como múltipla escolha (alternativas válidas) e/ou por escrito (resposta esperada).
 * A IA só completa o que dá para tirar da própria questão:
 *  - falta múltipla escolha → tem resposta esperada, não tem alternativas válidas;
 *  - falta discursiva → tem alternativas válidas (com a correta), não tem resposta esperada.
 * Pergunta sem nenhuma resposta não entra (não há de onde gerar).
 */

type ItemLike = Pick<QuestionItem, 'id' | 'expectedAnswer' | 'alternatives'>

const hasAnswer = (it: ItemLike) => !!it.expectedAnswer?.trim()

export function needsMultipleChoice(it: ItemLike): boolean {
  return hasAnswer(it) && !hasValidAlternatives(it)
}

export function needsDiscursive(it: ItemLike): boolean {
  return !hasAnswer(it) && hasValidAlternatives(it)
}

export interface MissingFormats<Q> {
  /** Questões com ao menos uma pergunta sem alternativas (e com resposta esperada). */
  multipla: Q[]
  /** Questões com ao menos uma pergunta sem resposta escrita (e com alternativas). */
  discursiva: Q[]
}

export function missingFormats<Q extends { items: ItemLike[] }>(questions: Q[]): MissingFormats<Q> {
  return {
    multipla: questions.filter((q) => q.items.some(needsMultipleChoice)),
    discursiva: questions.filter((q) => q.items.some(needsDiscursive)),
  }
}
