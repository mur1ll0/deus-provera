import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { aiEnv } from '../env'
import { breaker } from './breaker'
import { TASKS, type AiTask } from './models'

/**
 * Cliente de IA com fallback em 3 camadas (ver models.ts).
 * Toda chamada passa por aqui: orçamento, circuit breaker, timeout, validação e telemetria.
 */

let provider: ReturnType<typeof createOpenRouter> | null = null
function openrouter() {
  const e = aiEnv()
  provider ??= createOpenRouter({
    apiKey: e.OPENROUTER_API_KEY,
    baseURL: e.OPENROUTER_BASE_URL, // https://openrouter.ai/api/v1 (compatível com OpenAI)
    compatibility: 'strict',
    headers: {
      ...(e.OPENROUTER_APP_URL ? { 'HTTP-Referer': e.OPENROUTER_APP_URL } : {}),
      'X-Title': e.OPENROUTER_APP_NAME,
    },
  })
  return provider
}

// (sem "parameter properties": o front também compila este arquivo — erasableSyntaxOnly — nos testes do importador)
export class AiUnavailableError extends Error {
  readonly task: AiTask
  readonly attempts: AttemptLog[]
  constructor(task: AiTask, attempts: AttemptLog[]) {
    super(`Nenhum modelo conseguiu concluir a tarefa "${task}".`)
    this.task = task
    this.attempts = attempts
  }
}

/**
 * Conteúdo barrado pelo Guardrail do OpenRouter (detecção de prompt injection — HTTP 403 "Request blocked").
 * Não é problema de chave: os fluxos tratam como IA indisponível PARA ESTE conteúdo (rascunho sem IA sinalizado,
 * 503 com alternativa no simulado). Outro modelo não adianta — o guardrail vale para a chave toda.
 */
export class AiGuardrailBlockedError extends AiUnavailableError {
  readonly blocked = true
  constructor(task: AiTask, attempts: AttemptLog[]) {
    super(task, attempts)
    this.message = `Conteúdo barrado pelo guardrail do OpenRouter (possível prompt injection) na tarefa "${task}".`
  }
}

/**
 * Erro de CONFIGURAÇÃO/CONTA (chave inválida, sem saldo): trocar de modelo não resolve,
 * então a cadeia de fallback é interrompida e a mensagem orienta o que fazer.
 */
export class AiConfigError extends Error {
  readonly kind: 'auth' | 'credits'
  readonly status: number | undefined
  constructor(kind: 'auth' | 'credits', status: number | undefined, detail: string) {
    super(
      kind === 'auth'
        ? `Chave do OpenRouter recusada (HTTP ${status ?? '?'}). Confira OPENROUTER_API_KEY no .env ou crie outra em https://openrouter.ai/keys. ${detail}`
        : `Saldo do OpenRouter negativo/insuficiente (HTTP 402) — isso bloqueia até modelos gratuitos. Veja https://openrouter.ai/settings/credits. ${detail}`,
    )
    this.kind = kind
    this.status = status
  }
}

export interface AttemptLog {
  model: string
  ok: boolean
  errorKind?: 'rate_limit' | 'timeout' | 'invalid_output' | 'quality' | 'provider' | 'circuit_open' | 'not_found' | 'auth' | 'credits' | 'blocked'
  /** Status HTTP devolvido pelo OpenRouter, quando houver. */
  status?: number
  /** Mensagem resumida do erro (sem dados do usuário). */
  error?: string
  latencyMs: number
}

export interface StructuredCall<T> {
  task: AiTask
  schema: z.ZodType<T>
  system: string
  /** Conteúdo do usuário JÁ delimitado por wrapUntrusted(). */
  prompt: string
  /**
   * Imagens (tarefa `vision`): cada uma vai como parte multimodal precedida do seu rótulo de texto,
   * depois do `prompt`. JPEG/PNG em base64 sem o prefixo `data:`.
   */
  images?: { label: string; base64: string; mediaType: 'image/jpeg' | 'image/png' }[]
  /** Checagem semântica extra (grounding, distratores…). Retorna mensagem de erro ou null. */
  quality?: (value: T) => string | null
  onAttempt?: (log: AttemptLog) => void
  /** Dono da chamada — conta no limite diário por usuário (ai_call.user_id). */
  userId?: string
  /**
   * Prazo absoluto (epoch ms) para TODA a cadeia de fallback. Nenhuma tentativa começa se não houver
   * tempo para ela (mín. 20 s) e o timeout de cada uma é cortado ao que resta — essencial nas funções
   * Vercel (≤ 300 s): um bloco "difícil" levou 248 s passando por 3 modelos na avaliação real.
   */
  deadline?: number
}

const MIN_ATTEMPT_MS = 20_000

/** Grava cada requisição real ao OpenRouter (base do orçamento diário e do painel de telemetria). */
export type AiRecorder = (row: { userId?: string; task: AiTask; log: AttemptLog }) => Promise<void>
let recorder: AiRecorder | null = null
export function setAiRecorder(r: AiRecorder | null) {
  recorder = r
}

export interface StructuredResult<T> {
  value: T
  model: string
  attempts: AttemptLog[]
}

/** Extrai o status HTTP de erros do AI SDK (APICallError.statusCode) ou de causas aninhadas. */
function statusOf(err: unknown): number | undefined {
  let e = err as { statusCode?: number; status?: number; cause?: unknown; lastError?: unknown } | undefined
  for (let i = 0; i < 4 && e; i++) {
    const s = e.statusCode ?? e.status
    if (typeof s === 'number') return s
    e = (e.lastError ?? e.cause) as typeof e
  }
  return undefined
}

export function classify(err: unknown): { kind: NonNullable<AttemptLog['errorKind']>; status?: number } {
  const status = statusOf(err)
  const text = `${String((err as Error)?.message ?? err)} ${JSON.stringify((err as { responseBody?: unknown })?.responseBody ?? '')}`.toLowerCase()
  if (status === 403 && /request blocked|prompt injection|guardrail/.test(text)) return { kind: 'blocked', status }
  if (status === 401 || status === 403) return { kind: 'auth', status }
  if (status === 402) return { kind: 'credits', status }
  if (status === 404) return { kind: 'not_found', status } // modelo saiu do ar / slug inválido
  if (status === 429) return { kind: 'rate_limit', status }
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  if (msg.includes('429') || msg.includes('rate limit')) return { kind: 'rate_limit', status }
  if (msg.includes('abort') || msg.includes('timeout')) return { kind: 'timeout', status }
  if (msg.includes('no object') || msg.includes('validation') || msg.includes('json') || msg.includes('schema')) return { kind: 'invalid_output', status }
  return { kind: 'provider', status }
}

/** Mensagem curta do erro + causa (ex.: qual campo do schema falhou), sem conteúdo do usuário. */
const shortError = (err: unknown) => {
  const e = err as { message?: string; cause?: { message?: string } }
  const cause = e?.cause?.message ? ` | causa: ${e.cause.message}` : ''
  return `${e?.message ?? String(err)}${cause}`.replace(/\s+/g, ' ').slice(0, 300)
}

export async function callStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const cfg = TASKS[call.task]
  const attempts: AttemptLog[] = []
  const pending: Promise<void>[] = []
  const log = (l: AttemptLog) => {
    attempts.push(l)
    call.onAttempt?.(l)
    // circuit_open não chega a fazer requisição: não consome cota nem é gravado.
    if (recorder && l.errorKind !== 'circuit_open') pending.push(recorder({ userId: call.userId, task: call.task, log: l }).catch(() => undefined))
  }
  const flush = () => Promise.all(pending)

  for (let i = 0; i < cfg.chain.length; i++) {
    const modelId = cfg.chain[i]
    if (breaker.isOpen(modelId)) {
      log({ model: modelId, ok: false, errorKind: 'circuit_open', latencyMs: 0 })
      continue
    }
    // Camada 1: o OpenRouter tenta os próximos elos gratuitos se este falhar por erro/rate-limit.
    const serverSideFallbacks = cfg.chain.slice(i + 1).filter((m) => m.endsWith(':free') && !breaker.isOpen(m))
    const model = openrouter().chat(modelId, {
      extraBody: serverSideFallbacks.length ? { models: [modelId, ...serverSideFallbacks] } : {},
      plugins: cfg.structured ? [{ id: 'response-healing' }] : undefined,
    })

    let repairHint = ''
    // Camada 2: até 2 tentativas por elo (a 2ª com o erro de validação como dica de reparo).
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = call.deadline ? call.deadline - Date.now() : Infinity
      if (remaining < MIN_ATTEMPT_MS) {
        log({ model: modelId, ok: false, errorKind: 'timeout', error: 'prazo do passo esgotado — usando fallback', latencyMs: 0 })
        await flush()
        throw new AiUnavailableError(call.task, attempts)
      }
      const started = Date.now()
      const text = repairHint ? `${call.prompt}\n\nSUA RESPOSTA ANTERIOR FOI INVÁLIDA: ${repairHint}\nCorrija e responda novamente apenas com o JSON.` : call.prompt
      try {
        const { output } = await generateText({
          model,
          system: call.system,
          ...(call.images?.length
            ? {
                messages: [
                  {
                    role: 'user' as const,
                    content: [
                      { type: 'text' as const, text },
                      ...call.images.flatMap((img) => [
                        { type: 'text' as const, text: img.label },
                        { type: 'file' as const, data: img.base64, mediaType: img.mediaType },
                      ]),
                    ],
                  },
                ],
              }
            : { prompt: text }),
          output: Output.object({ schema: call.schema }),
          temperature: cfg.temperature,
          maxOutputTokens: cfg.maxOutputTokens,
          maxRetries: 0, // retries são nossos (com troca de modelo), não do SDK
          abortSignal: AbortSignal.timeout(Math.min(cfg.timeoutMs, remaining)),
        })
        const value = output as T
        const problem = call.quality?.(value) ?? null
        if (problem) {
          log({ model: modelId, ok: false, errorKind: 'quality', error: problem.slice(0, 200), latencyMs: Date.now() - started })
          repairHint = problem
          continue
        }
        breaker.success(modelId)
        log({ model: modelId, ok: true, latencyMs: Date.now() - started })
        await flush()
        return { value, model: modelId, attempts }
      } catch (err) {
        const { kind, status } = classify(err)
        log({ model: modelId, ok: false, errorKind: kind, status, error: shortError(err), latencyMs: Date.now() - started })
        // Guardrail da chave barrou o conteúdo: vale para qualquer modelo — encerra sem derrubar o fluxo.
        if (kind === 'blocked') {
          await flush()
          throw new AiGuardrailBlockedError(call.task, attempts)
        }
        // Chave inválida ou sem saldo: nenhum outro modelo vai funcionar — para tudo com mensagem clara.
        if (kind === 'auth' || kind === 'credits') {
          await flush()
          throw new AiConfigError(kind, status, shortError(err))
        }
        breaker.failure(modelId, kind)
        if (kind === 'invalid_output' && attempt === 0) {
          repairHint = String((err as Error).message).slice(0, 500)
          continue
        }
        break // erro de infraestrutura / modelo indisponível: próximo elo
      }
    }
  }
  await flush()
  throw new AiUnavailableError(call.task, attempts)
}
