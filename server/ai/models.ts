/**
 * Registro de modelos por TAREFA, com cadeia de fallback (somente modelos gratuitos `:free`).
 *
 * ⚠️ A lista gratuita do OpenRouter muda com frequência. Esta tabela é o único lugar a editar;
 * revalide com `npm run ai:eval` (fase 1) contra o conjunto de avaliação em server/ai/eval/.
 * Levantamento de 2026-11-19 (docs/05-pipeline-ia.md § Modelos).
 *
 * Camadas de fallback:
 *  1. Dentro da chamada: `models: [...]` do OpenRouter troca de modelo em erro/rate-limit/indisponibilidade.
 *  2. Na aplicação: se a SAÍDA for ruim (schema inválido, falha de grounding), tenta reparar 1x e
 *     depois passa para o próximo elo da cadeia.
 *  3. Último recurso: `openrouter/free` (roteador que escolhe um modelo gratuito compatível) e, se
 *     tudo falhar, fallback determinístico (segmentador/heurísticas) marcando "revisar".
 */

export type AiTask = 'structure' | 'classify' | 'distractors' | 'answers' | 'explain' | 'grade' | 'vision' | 'guard' | 'link'

export interface TaskConfig {
  /** Cadeia em ordem de preferência. Cada elo é uma chamada; dentro dela o OpenRouter ainda aplica `models`. */
  chain: string[]
  /** Exige `response_format: json_schema` estrito? (ver suporte por modelo) */
  structured: boolean
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
}

export const FREE_ROUTER = 'openrouter/free'

/**
 * ⚠️ ORÇAMENTO DE TOKENS (medido em 2026-11-20 com dados reais — docs/10 §5):
 * os melhores modelos gratuitos (ernie, nemotron, ling) são de RACIOCÍNIO OBRIGATÓRIO — o OpenRouter
 * recusa `reasoning.enabled=false` e eles ignoram `effort: low`/`max_tokens`. Mesmo UMA questão consome
 * ~4,8 mil tokens de raciocínio antes do JSON. Com `maxOutputTokens` baixo a resposta volta VAZIA
 * (finish_reason "length" → "No output generated"). Por isso os limites são altos (custo zero nos :free)
 * e os lotes de estruturação são pequenos (≤ 3 questões; import-graph.ts).
 */
export const TASKS: Record<AiTask, TaskConfig> = {
  // Texto → JSON de questões (PT-BR). Precisa de structured outputs e contexto longo.
  structure: {
    chain: ['baidu/ernie-5.5-flash-preview:free', 'nvidia/nemotron-3.5-super-vl:free', 'inclusionai/ling-3.2-flash:free', FREE_ROUTER],
    structured: true,
    temperature: 0,
    maxOutputTokens: 24_000,
    timeoutMs: 150_000,
  },
  classify: {
    // 2026-11-20 (npm run ai:ping): ling-3.2-flash estourou 45 s; ernie respondeu em ~3 s → ernie primeiro.
    chain: ['baidu/ernie-5.5-flash-preview:free', 'inclusionai/ling-3.2-flash:free', FREE_ROUTER],
    structured: true,
    temperature: 0,
    maxOutputTokens: 12_000,
    timeoutMs: 90_000,
  },
  distractors: {
    chain: ['baidu/ernie-5.5-flash-preview:free', 'nvidia/nemotron-3.5-super-vl:free', FREE_ROUTER],
    structured: true,
    temperature: 0.7,
    maxOutputTokens: 16_000,
    timeoutMs: 120_000,
  },
  // Resposta escrita + pontos de acerto a partir da alternativa correta (objetiva → discursiva).
  answers: {
    chain: ['baidu/ernie-5.5-flash-preview:free', 'nvidia/nemotron-3.5-super-vl:free', FREE_ROUTER],
    structured: true,
    temperature: 0.2,
    maxOutputTokens: 16_000,
    timeoutMs: 120_000,
  },
  // Explicações em texto livre: modelo de raciocínio sem JSON estrito; pedimos JSON simples e validamos.
  explain: {
    chain: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'baidu/ernie-5.5-flash-preview:free', FREE_ROUTER],
    structured: false,
    temperature: 0.3,
    maxOutputTokens: 12_000,
    timeoutMs: 90_000,
  },
  grade: {
    chain: ['baidu/ernie-5.5-flash-preview:free', 'inclusionai/ling-3.2-flash:free', FREE_ROUTER],
    structured: true,
    temperature: 0,
    maxOutputTokens: 10_000,
    timeoutMs: 90_000,
  },
  vision: {
    chain: ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free', 'inclusionai/ling-3.2-flash:free'],
    structured: true,
    temperature: 0,
    maxOutputTokens: 16_000,
    timeoutMs: 150_000,
  },
  // Questões × gabarito sem número em comum: só escolhe pares de ids (saída pequena). Mesma cadeia da classificação.
  link: {
    chain: ['baidu/ernie-5.5-flash-preview:free', 'inclusionai/ling-3.2-flash:free', FREE_ROUTER],
    structured: true,
    temperature: 0,
    maxOutputTokens: 6000,
    timeoutMs: 90_000,
  },
  // Classificador de injeção (camada 2 do guardrail): rápido e barato.
  guard: {
    chain: ['inclusionai/ling-3.2-flash:free', FREE_ROUTER],
    structured: true,
    temperature: 0,
    maxOutputTokens: 6000,
    timeoutMs: 45_000,
  },
}

/** Versão dos prompts — entra na chave do cache de IA; incremente ao alterar prompts. */
export const PROMPT_VERSION = 'v2'

/**
 * Princípio III da constituição: nenhum modelo pago na cadeia. Falha na inicialização
 * (cold start) em vez de gerar custo silencioso. Spec 005.
 */
export function assertFreeOnly(tasks: Record<string, TaskConfig> = TASKS): void {
  const paid = Object.entries(tasks).flatMap(([task, cfg]) => cfg.chain.filter((m) => m !== FREE_ROUTER && !m.endsWith(':free')).map((m) => `${task}: ${m}`))
  if (paid.length) throw new Error(`Modelos não gratuitos configurados: ${paid.join(', ')}`)
}
assertFreeOnly()
