/**
 * Mini "state graph" (estilo LangGraph, sem a dependência de ~98 MB).
 *
 * - Nós são funções puras-ish `(state, ctx) => Partial<state>`.
 * - Arestas fixas ou condicionais definem o fluxo de decisão (retry, fallback, loop de lotes).
 * - Cada passo produz um checkpoint serializável → persistido em import_job.state.
 * - `runUntil` executa até END ou até o prazo (funções Vercel ≤ 300 s), e retoma de onde parou.
 *
 * Decisão registrada em docs/adr/0003-orquestracao-ia.md (migrar para LangGraph é mecânico:
 * mesmos nós e arestas).
 */

export const END = '__end__'

export interface GraphState {
  cursor: string
  history: { node: string; ok: boolean; ms: number; note?: string }[]
}

type NodeFn<S, C> = (state: S, ctx: C) => Promise<Partial<S>>
type Router<S> = (state: S) => string

export class StateGraph<S extends GraphState, C> {
  private nodes = new Map<string, { fn: NodeFn<S, C>; retries: number }>()
  private edges = new Map<string, Router<S>>()
  private entry: string | null = null

  addNode(id: string, fn: NodeFn<S, C>, opts: { retries?: number } = {}) {
    this.nodes.set(id, { fn, retries: opts.retries ?? 0 })
    return this
  }

  setEntry(id: string) {
    this.entry = id
    return this
  }

  addEdge(from: string, to: string) {
    this.edges.set(from, () => to)
    return this
  }

  addConditionalEdges(from: string, router: Router<S>) {
    this.edges.set(from, router)
    return this
  }

  initial(state: Omit<S, 'cursor' | 'history'>): S {
    if (!this.entry) throw new Error('Grafo sem nó de entrada')
    return { ...state, cursor: this.entry, history: [] } as unknown as S
  }

  /** Executa um único nó e devolve o novo estado (checkpoint). */
  async step(state: S, ctx: C): Promise<S> {
    const node = this.nodes.get(state.cursor)
    if (!node) throw new Error(`Nó desconhecido: ${state.cursor}`)
    let lastErr: unknown
    for (let i = 0; i <= node.retries; i++) {
      const started = Date.now()
      try {
        const patch = await node.fn(state, ctx)
        const merged = { ...state, ...patch } as S
        const next = this.edges.get(state.cursor)?.(merged) ?? END
        return { ...merged, cursor: next, history: [...state.history, { node: state.cursor, ok: true, ms: Date.now() - started }] }
      } catch (err) {
        lastErr = err
        state = { ...state, history: [...state.history, { node: state.cursor, ok: false, ms: Date.now() - started, note: String((err as Error)?.message).slice(0, 200) }] }
      }
    }
    throw lastErr
  }

  /** Executa nós até END ou até faltar `safetyMs` para o prazo. */
  async runUntil(state: S, ctx: C, opts: { deadline: number; safetyMs?: number; onCheckpoint?: (s: S) => Promise<void> }): Promise<S> {
    const safety = opts.safetyMs ?? 60_000
    while (state.cursor !== END && Date.now() < opts.deadline - safety) {
      state = await this.step(state, ctx)
      await opts.onCheckpoint?.(state)
    }
    return state
  }
}
