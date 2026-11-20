import { describe, expect, it } from 'vitest'
import { classify } from '../ai/client'

/** Classificação de erros do OpenRouter (docs/05): o que interrompe a cadeia, o que passa para o próximo modelo. */
describe('classify (erros do provedor)', () => {
  const apiError = (statusCode: number, message: string, responseBody?: string) => Object.assign(new Error(message), { statusCode, responseBody })

  it('403 do Guardrail (prompt injection) = conteúdo barrado, não chave inválida', () => {
    expect(classify(apiError(403, 'Forbidden', '{"error":{"code":403,"message":"Request blocked: prompt injection patterns detected"}}')).kind).toBe('blocked')
  })
  it('401/403 comuns = chave recusada; 402 = sem saldo', () => {
    expect(classify(apiError(401, 'Unauthorized')).kind).toBe('auth')
    expect(classify(apiError(403, 'Forbidden', '{"error":{"message":"Key disabled"}}')).kind).toBe('auth')
    expect(classify(apiError(402, 'Payment Required')).kind).toBe('credits')
  })
  it('429 da cota DIÁRIA de modelos gratuitos = cota esgotada (pausa a importação), não limite por minuto', () => {
    expect(classify(apiError(429, 'Rate limit exceeded: free-models-per-day-high-balance. ')).kind).toBe('quota')
    expect(classify(apiError(429, 'Too Many Requests', '{"error":{"message":"Rate limit exceeded: free-models-per-day"}}')).kind).toBe('quota')
    expect(classify(apiError(429, 'Rate limit exceeded: free-models-per-min')).kind).toBe('rate_limit')
  })
  it('429 e 404 passam para o próximo modelo', () => {
    expect(classify(apiError(429, 'Too Many Requests')).kind).toBe('rate_limit')
    expect(classify(apiError(404, 'Not Found')).kind).toBe('not_found')
  })
})
