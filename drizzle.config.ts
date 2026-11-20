import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// Mesmo carregamento de scripts/load-env.ts: .env.local tem prioridade sobre .env (ambos fora do Git).
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file)
}

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    // Use a URL NÃO-pooled para migrações (DATABASE_URL_UNPOOLED na integração Neon/Vercel).
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
})
