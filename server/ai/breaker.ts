/**
 * Circuit breaker por modelo (memória da instância Fluid; complementado pela tabela ai_call).
 * Após N falhas seguidas o modelo é pulado por um tempo, evitando gastar a cota de 20 req/min
 * em um modelo gratuito que saiu do ar ou está saturado.
 */
const FAILURES_TO_OPEN = 3
const OPEN_MS = 5 * 60_000
const RATE_LIMIT_OPEN_MS = 60_000

interface State {
  failures: number
  openUntil: number
}

const states = new Map<string, State>()

export const breaker = {
  isOpen(model: string): boolean {
    const s = states.get(model)
    return !!s && s.openUntil > Date.now()
  },
  success(model: string) {
    states.delete(model)
  },
  failure(model: string, kind?: string) {
    const s = states.get(model) ?? { failures: 0, openUntil: 0 }
    s.failures++
    if (kind === 'rate_limit') s.openUntil = Date.now() + RATE_LIMIT_OPEN_MS
    else if (s.failures >= FAILURES_TO_OPEN) s.openUntil = Date.now() + OPEN_MS
    states.set(model, s)
  },
  snapshot() {
    return Object.fromEntries(states)
  },
}
