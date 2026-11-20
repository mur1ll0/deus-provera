/**
 * Guardrail determinístico (camada 1) — roda no cliente (feedback imediato) e no servidor (obrigatório).
 * Camadas seguintes (servidor): classificador LLM + delimitação de conteúdo + validação de saída por schema.
 * Ver docs/05-pipeline-ia.md § Guardrails.
 */

export type RiskLevel = 'baixo' | 'medio' | 'alto'

export interface GuardrailFinding {
  rule: string
  label: string
  excerpt: string
  weight: number
}

export interface GuardrailResult {
  clean: string
  risk: RiskLevel
  score: number
  findings: GuardrailFinding[]
}

interface Rule {
  id: string
  label: string
  pattern: RegExp
  weight: number
  /** Remove o trecho do texto limpo (além de sinalizar). */
  strip?: boolean
}

const RULES: Rule[] = [
  // Tentativas de sobrescrever instruções (PT/EN)
  { id: 'override-pt', label: 'Tentativa de ignorar instruções', weight: 5, strip: true,
    pattern: /\b(ignore|ignorar?|desconsider[ea]r?|esque[cç]a)\b[^.\n]{0,40}\b(instru[cç][õo]es|regras|prompt|comandos?)\b[^.\n]*/gi },
  { id: 'override-en', label: 'Prompt override (EN)', weight: 5, strip: true,
    pattern: /\b(ignore|disregard|forget)\b[^.\n]{0,30}\b(previous|prior|above|all)\b[^.\n]{0,30}\b(instructions|rules|prompts?)\b[^.\n]*/gi },
  { id: 'role-hijack', label: 'Troca de papel do modelo', weight: 4, strip: true,
    pattern: /\b(voc[eê] (agora )?(é|e|sera|será)|a partir de agora voc[eê]|act as|you are now|pretend to be|finja ser)\b[^.\n]*/gi },
  { id: 'prompt-leak', label: 'Pedido de vazamento de prompt/segredo', weight: 4, strip: true,
    pattern: /\b(revele|mostre|imprima|print|reveal|show)\b[^.\n]{0,30}\b(system prompt|prompt do sistema|suas instru[cç][õo]es|api[_ -]?key|chave|token|senha|password)\b[^.\n]*/gi },
  { id: 'jailbreak', label: 'Termos de jailbreak', weight: 4, strip: true,
    pattern: /\b(jailbreak|DAN mode|developer mode|modo desenvolvedor|sem restri[cç][õo]es|no restrictions)\b/gi },
  { id: 'chat-markup', label: 'Marcadores de chat/sistema', weight: 5, strip: true,
    pattern: /(<\|im_(start|end)\|>|<\/?(system|assistant|user|tool)>|\[\/?INST\]|###\s*(system|instruction)|<<SYS>>)/gi },
  // Conteúdo potencialmente perigoso para a aplicação
  { id: 'html-script', label: 'HTML/script embutido', weight: 3, strip: true,
    pattern: /<\s*(script|iframe|object|embed|style|link|meta)[^>]*>[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi },
  { id: 'js-url', label: 'URL javascript:/data:', weight: 3, strip: true,
    pattern: /\b(javascript|vbscript|data):[^\s)"']+/gi },
  { id: 'template-injection', label: 'Template/expressão de código', weight: 2,
    pattern: /(\$\{[^}]*\}|\{\{[^}]*\}\}|<%[\s\S]*?%>)/g },
  { id: 'shell', label: 'Comando de shell/SQL suspeito', weight: 2,
    pattern: /\b(rm\s+-rf|curl\s+https?:|wget\s+https?:|DROP\s+TABLE|UNION\s+SELECT|;\s*--)/gi },
  { id: 'tool-call', label: 'Tentativa de acionar ferramentas/URLs externas', weight: 3,
    pattern: /\b(chame|acesse|envie|fa[cç]a uma requisi[cç][ãa]o|call|fetch|send)\b[^.\n]{0,30}\b(https?:\/\/|webhook|endpoint|api)\b/gi },
  { id: 'base64-blob', label: 'Bloco codificado longo (base64)', weight: 2, strip: true,
    pattern: /\b[A-Za-z0-9+/]{120,}={0,2}\b/g },
]

// Caracteres invisíveis usados para esconder instruções
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g
// Controles C0 exceto \t \n \r
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function normalizeText(input: string): string {
  return input.normalize('NFKC').replace(INVISIBLE, '').replace(CONTROL, '').replace(/[ \t]+\n/g, '\n')
}

export function inspectText(input: string): GuardrailResult {
  let clean = normalizeText(input)
  const findings: GuardrailFinding[] = []

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    const matches = clean.match(rule.pattern)
    if (!matches) continue
    for (const m of matches.slice(0, 3)) {
      findings.push({ rule: rule.id, label: rule.label, excerpt: m.slice(0, 120), weight: rule.weight })
    }
    if (rule.strip) clean = clean.replace(rule.pattern, ' [removido pelo guardrail] ')
  }

  const score = findings.reduce((a, f) => a + f.weight, 0)
  const risk: RiskLevel = score >= 8 ? 'alto' : score >= 3 ? 'medio' : 'baixo'
  return { clean: clean.replace(/\s{3,}/g, '  ').trim(), risk, score, findings }
}

/**
 * Envolve conteúdo do usuário em delimitadores com nonce para o prompt do LLM.
 * O system prompt instrui o modelo a tratar tudo entre os marcadores como DADO, nunca como instrução.
 */
export function wrapUntrusted(content: string, nonce: string): string {
  const safe = content.replaceAll(`</dados_${nonce}>`, '')
  return `<dados_${nonce}>\n${safe}\n</dados_${nonce}>`
}
