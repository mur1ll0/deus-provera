/**
 * Carrega variáveis de ambiente para scripts locais (tsx), como a Vercel faz em produção.
 * Ordem: .env.local (prioridade) → .env. Variáveis já definidas no ambiente não são sobrescritas.
 * Os arquivos .env* são ignorados pelo Git — a chave nunca é commitada.
 */
import { existsSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file)
}
