/**
 * Regras de estatística do painel (spec 004) — puras e testadas, usadas no servidor.
 * Datas no fuso de Brasília (UTC−3, sem horário de verão), como o ranking (shared/simulado.ts).
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 86_400_000

/** Dia civil em Brasília, `YYYY-MM-DD`. */
export function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

/** Os `n` dias civis (BRT) terminando em `today`, do mais antigo ao mais recente. */
export function lastDays(n: number, today = new Date()): string[] {
  const end = Date.parse(`${brtDay(today)}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10))
}

/**
 * Sequência de estudo: dias seguidos com atividade. A atual conta até hoje — ou até ontem, se hoje
 * ainda não houve atividade (a sequência não "quebra" no meio do dia).
 */
export function computeStreak(days: Iterable<string>, today = new Date()): { current: number; best: number } {
  const set = new Set(days)
  if (!set.size) return { current: 0, best: 0 }
  const sorted = [...set].sort()
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = Date.parse(sorted[i]) - Date.parse(sorted[i - 1]) === DAY_MS ? run + 1 : 1
    best = Math.max(best, run)
  }
  const t = brtDay(today)
  let cursor = set.has(t) ? Date.parse(t) : Date.parse(t) - DAY_MS
  let current = 0
  while (set.has(new Date(cursor).toISOString().slice(0, 10))) {
    current++
    cursor -= DAY_MS
  }
  return { current, best }
}

/** Mínimo de respostas corrigidas para exibir a nota de desempenho (abaixo disso: "—"). */
export const MIN_ANSWERS_FOR_GRADE = 10
/**
 * Mínimo de respostas num assunto para apontá-lo como "ponto mais fraco" — evita que um único erro
 * decida. Era 5: com poucos simulados, só o assunto mais respondido passava e o painel apontava como
 * "mais fraco" um assunto com acerto ALTO enquanto o mapa mostrava outros em 0%.
 */
export const MIN_ANSWERS_FOR_WEAKEST = 2

/** Ponto mais fraco: menor acerto entre os assuntos com respostas suficientes; empate → o mais respondido. */
export function pickWeakest<T extends { accuracy: number; answered: number }>(topics: readonly T[]): T | null {
  return [...topics].filter((t) => t.answered >= MIN_ANSWERS_FOR_WEAKEST).sort((x, y) => x.accuracy - y.accuracy || y.answered - x.answered)[0] ?? null
}
