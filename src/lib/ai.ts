import { useCallback } from 'react'
import type { Alternative } from '@shared/domain'
import { useAuth } from '@/app/auth-context'
import { aiGenerateDistractors } from '@/mocks/ai'
import { api, unwrap } from './api'

/**
 * Distratores por IA (spec 005 › T037/T039) para o editor e a revisão da importação:
 * API real (`POST /api/ai/distractors`, até 6 perguntas = 1 requisição) ou, no protótipo sem API, a IA simulada.
 */

export interface DistractorRequest {
  id: string
  stem: string
  prompt?: string
  expectedAnswer: string
  /** Correta já escrita pelo usuário: preservada. */
  correct?: string
}

const BATCH = 6
const uid = () => `alt-${crypto.randomUUID().slice(0, 8)}`

/** Embaralha para a correta não ficar sempre na primeira posição. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function useDistractors(): { demo: boolean; generate: (items: DistractorRequest[]) => Promise<Map<string, Alternative[]>> } {
  const { mode } = useAuth()
  const real = mode === 'real'
  const generate = useCallback(
    async (items: DistractorRequest[]) => {
      const out = new Map<string, Alternative[]>()
      if (!real) {
        for (const it of items) {
          const alts = await aiGenerateDistractors({ expectedAnswer: it.expectedAnswer, prompt: it.prompt ?? '' })
          out.set(it.id, it.correct ? [{ id: uid(), text: it.correct, correct: true, source: 'usuario' }, ...alts.filter((a) => !a.correct)] : alts)
        }
        return out
      }
      for (let i = 0; i < items.length; i += BATCH) {
        const { items: res } = await unwrap(api.ai.distractors.$post({ json: { items: items.slice(i, i + BATCH) } }))
        for (const r of res) {
          const given = items.find((x) => x.id === r.id)
          out.set(
            r.id,
            shuffle<Alternative>([
              { id: uid(), text: r.correct, correct: true, source: given?.correct ? 'usuario' : 'ia' },
              ...r.incorrect.map((x) => ({ id: uid(), text: x.text, correct: false, explanation: x.explanation, source: 'ia' as const })),
            ]),
          )
        }
      }
      return out
    },
    [real],
  )
  return { demo: !real, generate }
}
