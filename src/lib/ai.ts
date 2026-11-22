import { useCallback } from 'react'
import type { Alternative } from '@shared/domain'
import { useAuth } from '@/app/auth-context'
import { aiGenerateDistractors } from '@/mocks/ai'
import { api, ApiError, unwrap } from './api'

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

/** Objetiva → discursiva (FR-R8): resposta escrita + pontos de acerto a partir da alternativa correta. */
export interface WrittenAnswerRequest {
  id: string
  stem: string
  prompt?: string
  alternatives: { text: string; correct: boolean; explanation?: string }[]
}

export interface WrittenAnswer {
  expectedAnswer: string
  keyPoints: string[]
}

/** Protótipo sem API: resposta = correta + comentário; pontos = trechos da correta. */
function fakeWrittenAnswer(it: WrittenAnswerRequest): WrittenAnswer {
  const correct = it.alternatives.find((a) => a.correct)
  const text = [correct?.text, correct?.explanation].filter(Boolean).join('. ')
  const parts = (correct?.text ?? '').split(/[,;]|\be\b/).map((s) => s.trim()).filter((s) => s.length > 2)
  return { expectedAnswer: text, keyPoints: (parts.length >= 3 ? parts : [...parts, 'Justificativa', 'Conceito-chave']).slice(0, 6) }
}

export function useWrittenAnswers(): { demo: boolean; generate: (items: WrittenAnswerRequest[]) => Promise<Map<string, WrittenAnswer>> } {
  const { mode } = useAuth()
  const real = mode === 'real'
  const generate = useCallback(
    async (items: WrittenAnswerRequest[]) => {
      const out = new Map<string, WrittenAnswer>()
      if (!real) {
        await new Promise((r) => setTimeout(r, 600))
        for (const it of items) out.set(it.id, fakeWrittenAnswer(it))
        return out
      }
      for (let i = 0; i < items.length; i += BATCH) {
        const { items: res } = await unwrap(api.ai.answers.$post({ json: { items: items.slice(i, i + BATCH) } }))
        for (const r of res) out.set(r.id, { expectedAnswer: r.expectedAnswer, keyPoints: r.keyPoints })
      }
      return out
    },
    [real],
  )
  return { demo: !real, generate }
}

export interface BatchRun<T> {
  out: Map<string, T>
  /** Perguntas que ficaram sem resultado (lote com erro ou não processado depois de um 429). */
  failed: number
  /** Primeiro erro (ex.: cota diária esgotada) — o que já foi gerado é mantido. */
  error?: string
}

/**
 * Roda uma geração em lotes de 6 (1 requisição cada), até `concurrency` ao mesmo tempo, com progresso.
 * Erro num lote não perde os anteriores; cota esgotada (429) para os lotes seguintes.
 */
export async function runAiBatches<Req extends { id: string }, T>(
  items: Req[],
  generate: (batch: Req[]) => Promise<Map<string, T>>,
  { onProgress, concurrency = 3, signal }: { onProgress?: (done: number, total: number) => void; concurrency?: number; signal?: AbortSignal } = {},
): Promise<BatchRun<T>> {
  const batches: Req[][] = []
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))
  const out = new Map<string, T>()
  let next = 0
  let done = 0
  let error: string | undefined
  let stop = false
  onProgress?.(0, items.length)
  async function worker() {
    while (!stop && !signal?.aborted && next < batches.length) {
      const batch = batches[next++]
      try {
        const res = await generate(batch)
        for (const [k, v] of res) out.set(k, v)
      } catch (err) {
        const msg = (err as Error).message || 'IA indisponível agora.'
        error ??= msg
        if ((err instanceof ApiError && err.status === 429) || /cota/i.test(msg)) stop = true
      }
      done += batch.length
      onProgress?.(Math.min(done, items.length), items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))
  return { out, failed: items.length - out.size, error: signal?.aborted ? 'Geração interrompida.' : error }
}
