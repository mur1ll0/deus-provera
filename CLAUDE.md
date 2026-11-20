# CLAUDE.md — memória do projeto Deus Proverá

Plataforma de estudos (Medicina e outros cursos): importa questões de PDFs, gera simulados configuráveis (prova/treino) com tempo por questão, correção, explicações por IA (OpenRouter, só modelos gratuitos), pontuação e ranking.

## Como trabalhar neste repositório (spec-driven)

1. **Leia a constituição** `.specify/memory/constitution.md` (7 princípios — não negociáveis).
2. Toda mudança parte de uma spec em `specs/NNN-*/`: `spec.md` (o quê/por quê) → `plan.md` (como) → `tasks.md` (passos `T###`). Marque `[x]` nas tarefas concluídas no mesmo commit.
3. Mudou comportamento? Atualize spec/contrato/doc **no mesmo PR**. Dúvida real → `[PRECISA ESCLARECER: …]` na spec.
4. Antes de concluir: `npm run check` (tipos + lint + testes) e, se mexeu em UI, validar no navegador (desktop e 375 px).

## Mapa

| Onde | O quê |
|---|---|
| `docs/00-visao-geral.md` | Índice da documentação, glossário, decisões resumidas |
| `docs/05-pipeline-ia.md` | Modelos, fallback, grafo, guardrails, cota — **leia antes de mexer em `server/ai/`** |
| `docs/07-pontuacao-e-ranking.md` | Regras de pontos — espelhadas em `shared/scoring.ts` |
| `docs/10-avaliacao-importador.md` | Gabarito de referência dos PDFs e métricas do importador |
| `docs/11-provedores-ia.md` | Limites reais (OpenRouter 50/1000 por dia), provedores grátis, BYOK (OpenRouter PKCE) |
| `scripts/` | `gabarito.ts` (parser do gabarito), `build-gabarito.ts`, `eval-import.ts`, `sync-prompt-doc.ts` |
| `specs/001…005` | Autenticação, Importação (principal), Simulados, Dashboard/Ranking, IA/Guardrails |
| `shared/` | Regras puras cliente+servidor (+ `__tests__`): `scoring`, `guardrails`, `segmenter`, `schemas/import` (contrato JSON v2), `prompts/external-agent` |
| `src/` | Frontend React. `src/mocks/` = dados e IA **simulados** do protótipo (serão trocados pela API) |
| `server/` | Backend Hono: `app.ts`, `auth.ts`, `db/schema.ts`, `routes/`, `ai/` |
| `api/index.ts` | Entrada da função Vercel (exporta o app Hono) |

## Comandos

```bash
npm run dev          # protótipo (Vite, http://localhost:5173) — funciona sem backend
npm run dev:api      # SPA + API Hono na mesma origem (http://localhost:3000) — login Google e Neon reais; exige .env
npm run dev:full     # alternativa com vercel dev (projeto vinculado na Vercel)
npm run check        # typecheck (front+server) + oxlint + vitest
npm test             # vitest (sem banco)
npm run test:db      # *.db.test.ts contra o Postgres (.env ou TEST_DATABASE_URL) — cria/apaga dados test-db-*; AI_LIVE=1 inclui chamadas reais ao OpenRouter
npm run test:e2e     # Playwright (sobe dev:api; sessão de teste no banco); E2E_AI=1 importa os PDFs de exemplo com IA real
npm run db:seed:large # seed grande + medição (banco separado, ou --shared-db-ok: mede e apaga)
npm run build        # tsc -b && vite build
npm run db:generate  # gera migração a partir de server/db/schema.ts
npm run db:migrate   # aplica migrações (usa DATABASE_URL_UNPOOLED)
npm run db:seed      # áreas/disciplinas comuns (idempotente)
npm run ai:ping        # testa o OpenRouter de ponta a ponta (chave, modelos :free, 1 requisição real)
npm run gabarito:build  # junta samples/private/extracao/*.md → gabarito MD + JSON v2 (privado)
npm run eval:import     # mede o importador contra o gabarito (docs/10); `-- --ai` usa OpenRouter; `-- --vision` mede a etapa de visão (imagens)
npm run prompt:sync     # regenera docs/prompts/prompt-agente-externo.md a partir do código
```

## Stack (fixada em 2026-11-19)

Node 24 · Vite 8 · React 19.3 · React Router 8 · Tailwind 4.3 · TypeScript 7 · Hono 4.13 · Drizzle 0.45 + Neon · Better Auth 1.7 · AI SDK 7 + @openrouter/ai-sdk-provider 3.1 · zod 4 · pdfjs-dist 6.5 · vitest 5 · oxlint.

## Regras que quebram fácil

- **OpenRouter:** base `https://openrouter.ai/api/v1` (`OPENROUTER_BASE_URL`), chave em `OPENROUTER_API_KEY` no `.env`/`.env.local` (ignorados pelo Git — nunca imprimir nem commitar). Scripts carregam o env via `scripts/load-env.ts`. Erros 401/403/402 interrompem a cadeia (`AiConfigError`); 404/429/timeout passam para o próximo modelo.
- **IA:** só modelos `:free` em `server/ai/models.ts` (um pago na cadeia = bug). Toda chamada via `callStructured()` (orçamento, breaker, fallback, telemetria). Conteúdo do usuário SEMPRE via `wrapUntrusted()` + guardrail. Modelos sem ferramentas.
- **Função da API na Vercel:** `api/index.ts` importa `api/_server.mjs`, o `server/app.ts` empacotado por `npm run build:api` (esbuild, roda dentro do `npm run build`; arquivo gerado, fora do Git). Sem o bundle, o Node ESM da Vercel não resolve imports relativos sem extensão (`ERR_MODULE_NOT_FOUND`).
- **Limites Vercel Hobby:** corpo ≤ 4,5 MB (PDF nunca vai ao servidor — só texto); função ≤ 300 s (pipeline com checkpoint em `import_job.state`, `/run` em loop).
- **Pontuação/gabarito/prazo:** decididos no servidor com `shared/scoring.ts`. Na prova em andamento a API nunca envia `correct`/`expectedAnswer`.
- **Saída de IA** é texto puro no React (nunca `dangerouslySetInnerHTML`).
- **Taxonomia:** Área › Disciplina › Assunto ("Tema" do cliente = Área). Assunto é AMPLO (tema da aula), não a pergunta.
- **Questão = Enunciado + Perguntas** (`Question.stem` + `Question.items[]`). Cada pergunta (`QuestionItem`) tem a sua resposta: discursiva (resposta esperada + pontos de acerto) e/ou múltipla escolha (alternativas). Pontuação e correção são **por pergunta**; tempo é **por questão**. Formato do simulado: `answerFormat` (original | multipla | discursiva) + `presentAs()`/`isEligible()` em `shared/simulado.ts`.
- **Importador:** mudou o segmentador ou o pipeline? Rode `npm run eval:import` e compare com a tabela de docs/10 antes de concluir (não piorar recall/precisão).
- **Visão (imagens das páginas):** o texto leva `[[imagem pN-k]]` na posição da imagem; só o RECORTE em JPEG vai ao servidor (`POST /api/imports/:id/images`, ≤ 3 por requisição, nada armazenado além da transcrição); o nó `segment` troca o marcador por `[Imagem p. N: …]`. Posição/recorte em `shared/page-images.ts` (docs/05 §5.1).
- **Gabarito de referência** (`samples/private/`) é conteúdo de terceiros: nunca versionar nem colar em issues/PRs.
- Textos de UI/doc em pt-BR; identificadores em inglês, exceto o contrato JSON de importação (pt-BR).
- `src/mocks/` é descartável: não importar de `src/mocks` em código novo que vá para produção (exceção temporária: fallback de login do protótipo em `src/app/AuthProvider.tsx`, só em DEV sem API).
- **Auth no SPA:** `useAuth()` (`src/app/auth-context.ts`), nunca `useStore().loggedIn`. Dados da API via `api` (Hono RPC, `src/lib/api.ts`) + TanStack Query + `unwrap()`.
- PDFs na raiz do repo são exemplos do usuário com conteúdo de terceiros — **não versionar** (já no `.gitignore`).

## Estado atual

Fase 0 concluída (planejamento + protótipo) + revisão de 2026-11-20 (modelo enunciado + perguntas, contrato v2, gabarito de referência e avaliação do importador: ~90% recall / ~95% precisão sem IA). Avaliação **com IA** pendente de `OPENROUTER_API_KEY`. Próximo: Fase 1 / S1 — ver `docs/08-roadmap.md`; considerar o pool multi-provedor e "Conectar OpenRouter" (docs/11).
S1 (2026-11-20) em andamento: auth real no SPA (AuthProvider/RequireAuth), `/api/questions` + `/api/taxonomy`, Banco de questões lendo da API, migração `0000_init` e seed **aplicados no Neon**; login Google real e CRUD de questões pela tela validados localmente contra o Neon. Produção no ar em https://deus-provera.vercel.app (login Google validado). Perfil (`/perfil`, `/api/profile`), exclusão de conta (`DELETE /api/account`), aviso único do ranking e ranking com `display_name` prontos (spec 001 US3/US4). Simulados, dashboard, ranking (tela) e importação ainda usam o store mock.
S2 (2026-11-20): commit da importação real (`POST /api/imports/:id/commit`, os três métodos → Neon, sem duplicatas). S3 (2026-11-20): simulados (sorteio, prazo, respostas, revelação no treino, finalização idempotente com ledger, resultado e correção posterior), painel (`/api/stats/me`) e ranking reais — telas na API, store mock só no modo protótipo; autosave da revisão da importação (T042). IA no simulado real (dica, explicação, correção — `/api/simulados/:id/{hint,explain,ai-grade}`), distratores (`/api/ai/distractors`), ranking por área, abandono > 24 h (cron), acessibilidade do cronômetro, E2E Playwright e seed grande (2026-11-20). Créditos OpenRouter ativos (1000 req/dia; `AI_USER_DAILY_LIMIT` padrão 200).
