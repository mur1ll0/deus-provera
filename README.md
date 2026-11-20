# Deus Proverá

> Estude como a prova cobra. O resto, Deus proverá.

Plataforma de estudos para Medicina e outros cursos. O estudante transforma as **próprias listas de questões em PDF** em um banco de questões e treina com **simulados configuráveis**: modo **prova** (aleatório, cronometrado, gabarito no fim, vale 3× mais pontos) ou **treino** (filtros por assunto, resposta a cada questão, dicas de IA). O sistema mede o tempo por questão e por simulado, corrige objetivas e discursivas, explica cada alternativa com IA (OpenRouter, modelos gratuitos) e mantém um **ranking** de estudantes.

## Status

**Fase 0 concluída:** planejamento completo + **protótipo navegável** para validar layout e fluxos.
No protótipo, login, dados e IA são **simulados** (localStorage). Algumas partes já são reais e rodam no navegador:

- extração de texto de PDF (pdf.js) e detecção de páginas com imagem;
- segmentação das questões e subitens (testado com os PDFs de exemplo: ~140 itens cada);
- validação do JSON do agente externo (zod) e guardrail contra injeção;
- regras de pontuação.

## Rodar o protótipo

Requisitos: Node 24.

```bash
npm install
npm run dev
# abra http://localhost:5173 → "Entrar com Google" (simulado)
```

Roteiro sugerido para validar:

1. **Painel**: estatísticas + ranking no painel direito.
2. **Importar questões → PDF com IA**: arraste `Unidade II.pdf` → veja questões (enunciados) e perguntas detectadas → *Processar com IA* → **revise os cards** (arraste questões entre cards, edite o enunciado e cada pergunta, crie card, gere múltipla escolha) → *Confirmar e salvar*.
   - Para usar o **gabarito de referência** (questões reais extraídas dos 2 PDFs, com pontos de acerto e alternativas): *Usar meu agente de IA → Carregar arquivo* → `samples/private/gabarito-iii-unidade.json` (gere com `npm run gabarito:build`).
3. **Importar → Usar meu agente de IA**: copie o prompt, ou clique *Usar exemplo* → *Validar e revisar*.
4. **Simulados**: monte um treino (revelar a cada questão + dicas) e uma prova (tempo limite, gabarito no fim) → veja o **resultado** com tempo por questão e correção de discursivas.
5. *Restaurar dados de demonstração* (barra lateral) volta ao estado inicial.

## Documentação

- 📐 [Visão geral e índice](docs/00-visao-geral.md)
- 🔎 [Análise da plataforma de inspiração](docs/01-analise-inspiracao.md)
- ✅ [Requisitos de usuário](docs/02-requisitos-usuario.md) · ⚙️ [Requisitos técnicos](docs/03-requisitos-tecnicos.md)
- 🏗️ [Arquitetura](docs/04-arquitetura.md) · 🗄️ [Modelo de dados](docs/06-modelo-de-dados.md)
- 🤖 [Pipeline de IA, modelos gratuitos, fallback e guardrails](docs/05-pipeline-ia.md)
- 🏆 [Pontuação e ranking](docs/07-pontuacao-e-ranking.md) · 🗺️ [Roadmap](docs/08-roadmap.md) · 🧭 [ADRs](docs/09-decisoes-adr.md)
- 📋 Specs: [001 Autenticação](specs/001-autenticacao/spec.md) · [002 Importação](specs/002-importacao-questoes/spec.md) · [003 Simulados](specs/003-simulados/spec.md) · [004 Dashboard e ranking](specs/004-dashboard-ranking/spec.md) · [005 IA e guardrails](specs/005-ia-assistente-guardrails/spec.md)
- 📜 [Constituição do projeto](.specify/memory/constitution.md) · 🤝 [Prompt para agente externo](docs/prompts/prompt-agente-externo.md)

## Stack

Vite 8 · React 19 · React Router 8 · Tailwind 4 · Hono (Vercel Functions, Node 24) · Neon Postgres + Drizzle · Better Auth (Google) · AI SDK 7 + OpenRouter (modelos `:free`) · zod · pdf.js · Vitest.

## Scripts

| Script | Descrição |
|---|---|
| `npm run dev` | Protótipo (Vite, porta 5173) — sem API: login simulado |
| `npm run dev:api` | SPA + API Hono na mesma origem (http://localhost:3000) — login Google real e banco Neon (requer `.env`) |
| `npm run dev:full` | Alternativa com `vercel dev` (requer projeto vinculado na Vercel) |
| `npm run check` | Tipos + lint + testes (sem banco) |
| `npm run test:db` | Testes de integração contra o Postgres do `.env` (ou `TEST_DATABASE_URL`, de preferência um branch do Neon): login Google simulado, ranking e exclusão de conta |
| `npm run build` | Build de produção |
| `npm run db:generate` / `db:migrate` | Migrações Drizzle (lê `.env.local`/`.env`; usa `DATABASE_URL_UNPOOLED`) |
| `npm run db:seed` | Áreas e disciplinas comuns (idempotente) |
| `npm run gabarito:build` | Gera o gabarito de referência (MD + JSON v2) a partir da extração dos PDFs |
| `npm run eval:import` | Mede o importador contra o gabarito ([docs/10](docs/10-avaliacao-importador.md)); `-- --ai` usa OpenRouter |

## Configurar e testar o OpenRouter

1. Crie uma chave em <https://openrouter.ai/keys> e coloque no arquivo `.env` (ou `.env.local`) na raiz — ambos são ignorados pelo Git:
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   OPENROUTER_BASE_URL=https://openrouter.ai/api/v1   # opcional; este é o padrão
   ```
2. Teste de ponta a ponta (valida a chave, confere se os modelos configurados existem e são gratuitos, e faz uma requisição real com fallback):
   ```
   npm run ai:ping
   ```
3. Avaliar o importador com IA contra o gabarito (consome ~3 requisições por lote): `npm run eval:import -- --ai --batches 3`.

O app usa o provider oficial do OpenRouter para o AI SDK (`@openrouter/ai-sdk-provider`), apontado para `https://openrouter.ai/api/v1`; os modelos ficam em `server/ai/models.ts` (somente `:free`).

## Rodar com login e banco reais (local)

1. **Neon**: em [console.neon.tech](https://console.neon.tech) crie um projeto (região São Paulo) → *Connect* → copie a URL **com pooling** para `DATABASE_URL` e **sem pooling** para `DATABASE_URL_UNPOOLED` no `.env` (fora do Git).
2. **Google OAuth**: [Google Cloud Console](https://console.cloud.google.com) → *APIs e serviços* → *Tela de consentimento* (Externo; escopos `openid email profile`; adicione seu Gmail em usuários de teste) → *Credenciais* → *ID do cliente OAuth* (Aplicativo da Web) com origem `http://localhost:3000` e redirecionamento `http://localhost:3000/api/auth/callback/google` → copie para `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
3. `BETTER_AUTH_SECRET` (≥ 32 caracteres aleatórios, ex.: `openssl rand -base64 32`) e `BETTER_AUTH_URL=http://localhost:3000`.
4. `npm run db:migrate && npm run db:seed && npm run dev:api` → abra http://localhost:3000 → *Entrar com Google*.

## Deploy (Fase 1)

1. Criar projeto na Vercel a partir do repositório (framework: Vite; `vercel.json` já configura a API e o fallback do SPA).
2. Marketplace → **Neon** → conectar ao projeto (injeta `DATABASE_URL`/`DATABASE_URL_UNPOOLED`).
3. Google Cloud Console → credenciais OAuth (redirect: `https://<domínio>/api/auth/callback/google`).
4. OpenRouter → criar chave, **comprar US$10 de créditos uma vez** (libera 1000 req/dia nos modelos gratuitos) e ativar o guardrail de prompt injection em modo *flag*.
5. Preencher as variáveis de `.env.example` na Vercel e rodar `npm run db:migrate`.
