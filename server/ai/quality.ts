import type { Distractors, StructuredBatch } from './schemas'

/**
 * Checagens semânticas de qualidade (camada além do schema).
 * Retornam mensagem de erro (vira "dica de reparo" para o modelo) ou null.
 */

const norm = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Proporção de trigramas de palavras do trecho que aparecem na fonte. */
export function overlap(candidate: string, source: string): number {
  const words = norm(candidate).split(' ')
  if (words.length < 3) return norm(source).includes(norm(candidate)) ? 1 : 0
  const src = norm(source)
  let hit = 0
  let total = 0
  for (let i = 0; i + 2 < words.length; i++) {
    total++
    if (src.includes(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)) hit++
  }
  return total ? hit / total : 0
}

/**
 * Grounding: o enunciado devolvido precisa existir na fonte (evita questões inventadas/alucinadas).
 * Limiar baixo porque o modelo pode corrigir OCR e quebras de linha.
 */
export function checkGrounding(batch: StructuredBatch, sourceById: Record<string, string>): string | null {
  for (const q of batch.questoes) {
    const src = sourceById[q.bloco_id]
    if (!src) return `bloco_id "${q.bloco_id}" não existe na entrada.`
    if (overlap(q.enunciado, src) < 0.5) return `O enunciado do bloco ${q.bloco_id} não corresponde ao texto original. Transcreva, não reescreva.`
    for (const p of q.perguntas) {
      const tag = `bloco ${q.bloco_id}, pergunta ${p.rotulo ?? 'única'}`
      if (p.texto && overlap(p.texto, src) < 0.5) return `O texto da ${tag} não corresponde ao original. Transcreva, não reescreva.`
      if (p.resposta_esperada && overlap(p.resposta_esperada, src) < 0.35) return `A resposta da ${tag} não foi encontrada no texto. Não invente respostas; use null se não houver.`
    }
  }
  return null
}

const BANNED = /(todas as (alternativas )?anteriores|nenhuma das (alternativas )?anteriores|todas est[aã]o corretas)/i

export function checkDistractors(d: Distractors): string | null {
  for (const it of d.itens) {
    const all = [it.correta, ...it.incorretas.map((x) => x.texto)]
    const normed = all.map(norm)
    if (new Set(normed).size !== normed.length) return `Item ${it.id}: alternativas repetidas.`
    if (all.some((t) => BANNED.test(t))) return `Item ${it.id}: não use "todas/nenhuma das anteriores".`
    const lens = all.map((t) => t.length)
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length
    if (it.correta.length > avg * 1.8) return `Item ${it.id}: a correta está muito maior que as outras (denuncia a resposta). Equilibre os tamanhos.`
    for (const x of it.incorretas) if (overlap(x.texto, it.correta) > 0.85) return `Item ${it.id}: distrator quase idêntico à correta.`
  }
  return null
}
