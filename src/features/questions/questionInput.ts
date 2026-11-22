import type { QuestionInput } from '@shared/schemas/question'
import type { DraftQuestion } from '@/mocks/model'

/** Área (id) › Disciplina (nome, pode ser nova) › Assunto, como o editor do banco envia à API. */
export interface Classification {
  areaId: string
  discipline: string
  topic: string
}

export function classificationErrors(c: Classification): string[] {
  const errors: string[] = []
  if (!c.areaId) errors.push('Escolha a área.')
  if (c.discipline.trim().length < 2) errors.push('Informe a disciplina.')
  return errors
}

/** Rascunho do editor → corpo de `POST /api/questions` / `PUT /api/questions/:id` (substituição completa). */
export function toInput(d: DraftQuestion, c: Classification): QuestionInput {
  return {
    areaId: c.areaId,
    discipline: c.discipline,
    topic: c.topic || undefined,
    sourceLabel: d.sourceLabel,
    stem: d.stem,
    difficulty: d.difficulty,
    visibility: d.visibility,
    hasImage: d.hasImage ?? false,
    imageDescription: d.imageDescription,
    items: d.items.map((it) => ({
      id: it.id,
      label: it.label,
      prompt: it.prompt,
      type: it.type,
      expectedAnswer: it.expectedAnswer,
      keyPoints: it.keyPoints ?? [],
      alternatives: (it.alternatives ?? []).map((a) => ({ id: a.id, text: a.text, correct: a.correct, explanation: a.explanation, source: a.source })),
    })),
  }
}
