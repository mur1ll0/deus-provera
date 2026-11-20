import { z } from 'zod'

/** Valores vazios no .env (ex.: `OPENROUTER_APP_URL=`) contam como "não definidos". */
const opt = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s)

/** Base da API do OpenRouter (compatível com OpenAI). Docs: https://openrouter.ai/docs/quickstart */
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

/** Variáveis de ambiente validadas na inicialização (falha cedo e com mensagem clara). */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Neon (injetado pela integração Vercel Marketplace)
  DATABASE_URL: z.string().url(),
  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // OpenRouter
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: opt(z.string().url().default(OPENROUTER_DEFAULT_BASE_URL)),
  /** Enviado como HTTP-Referer: identifica o app no OpenRouter (rankings/estatísticas). */
  OPENROUTER_APP_URL: opt(z.string().url().optional()),
  /** Enviado como X-Title. */
  OPENROUTER_APP_NAME: opt(z.string().default('Deus Provera')),
  /** Orçamento diário de requisições de IA do app (1000/dia com ≥ US$10 de créditos; 50/dia sem). */
  AI_DAILY_BUDGET: opt(z.coerce.number().int().positive().default(900)),
  /** Limite por usuário/dia para evitar que um usuário consuma a cota de todos. */
  AI_USER_DAILY_LIMIT: opt(z.coerce.number().int().positive().default(200)),
  /** Segredo das rotinas agendadas (Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`). Sem ele, /api/cron/* fica desligado. */
  CRON_SECRET: opt(z.string().min(16).optional()),
})

export type Env = z.infer<typeof schema>

/** Subconjunto usado só pelo cliente de IA — permite rodar a avaliação (`npm run eval:import -- --ai`) sem banco/auth. */
const aiSchema = schema.pick({ OPENROUTER_API_KEY: true, OPENROUTER_BASE_URL: true, OPENROUTER_APP_URL: true, OPENROUTER_APP_NAME: true })
export function aiEnv(): z.infer<typeof aiSchema> {
  const parsed = aiSchema.safeParse(process.env)
  if (!parsed.success) {
    const missingKey = !process.env.OPENROUTER_API_KEY
    throw new Error(
      missingKey
        ? 'OPENROUTER_API_KEY não configurada. Crie uma chave em https://openrouter.ai/keys e coloque no .env (nunca commite).'
        : `Configuração do OpenRouter inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }
  return parsed.data
}

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')
    throw new Error(`Variáveis de ambiente inválidas:\n  ${missing}\nVeja .env.example`)
  }
  cached = parsed.data
  return cached
}
