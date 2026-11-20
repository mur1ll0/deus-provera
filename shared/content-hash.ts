/**
 * Hash do conteúdo de uma questão para detectar duplicatas (mesmo dono): `question.content_hash`.
 * Considera o ENUNCIADO, o texto de cada PERGUNTA e de cada alternativa — não as respostas,
 * para que corrigir um gabarito não transforme a questão em "outra".
 * Normalização: minúsculas, sem acentos, sem pontuação, espaços colapsados.
 * Usa Web Crypto (Node 24 e navegador).
 */

export interface HashableQuestion {
  stem: string
  items: { prompt: string; alternatives?: { text: string }[] }[]
}

export function normalizeForHash(s: string): string {
  return s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function contentHashSource(q: HashableQuestion): string {
  const parts = [normalizeForHash(q.stem)]
  for (const it of q.items) {
    parts.push(`#${normalizeForHash(it.prompt)}`)
    for (const a of it.alternatives ?? []) parts.push(`*${normalizeForHash(a.text)}`)
  }
  return parts.join('\n')
}

export async function contentHash(q: HashableQuestion): Promise<string> {
  const bytes = new TextEncoder().encode(contentHashSource(q))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
