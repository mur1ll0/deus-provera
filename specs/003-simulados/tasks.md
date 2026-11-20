# Tarefas — 003 Simulados

**Legenda**: `[P]` = paralelizável (arquivos independentes) · `[x]` = concluída

## Fase A — Setup

- [x] T001 Tipos de domínio `SimuladoConfig`, `AnswerRecord`, `SimuladoAttempt` em `shared/domain.ts`
- [x] T002 Regras de pontuação `scoreQuestion`/`scoreSimulado` em `shared/scoring.ts` + testes em `shared/__tests__/scoring.test.ts`
- [x] T003 Tabelas `attempt`, `attempt_answer`, `points_ledger` em `server/db/schema.ts`
- [x] T004 Adicionar `attempt.status` (enum `em_andamento|finalizado|abandonado`) e `attempt_answer.presented_as` em `server/db/schema.ts` e gerar a migração (`npm run db:generate`) — feito diferente: o status é derivado de `finished_at`; migração `0001_simulados` adicionou `attempt.score_detail`, `attempt_answer.revealed_at` e o índice único `points_ledger (attempt_id, reason)`

## Fase B — Fundação

- [x] T005 [P] Mover `presentAs()` de `src/mocks/model.ts` para `shared/simulado.ts` e criar `autoTimeLimitMin(questions)` e `orderByCase(questions)` — **parcial**: `presentAs` e `autoTimeLimitMin` já em `shared/simulado.ts` com testes; falta `orderByCase`
- [x] T006 [P] Testes de `shared/simulado.ts` em `shared/__tests__/simulado.test.ts`: conversão discursiva→objetiva, tempo automático (mín. 5), ordenação a/b/c dentro do caso
- [x] T007 Serializadores `toPublicQuestion()` (sem gabarito) e `toResultQuestion()` em `server/services/simulados.ts`
- [x] T008 Teste de contrato: nenhuma rota de tentativa em andamento expõe `correct|explanation|expectedAnswer|keyPoints` (`server/__tests__/simulados.contract.test.ts`)
- [x] T009 [P] Cliente de API tipado em `src/lib/api.ts` (`hc<AppType>` ou fetch + zod) com tratamento de 401/409/422/429

## Fase C — US1 Modo prova (P1)

- [x] T010 `POST /api/simulados` com sorteio, prova forçando `reveal=final`/`aiHints=false` e `deadlineAt` (+15 s) em `server/routes/simulados.ts`
- [x] T011 Manter subitens do mesmo caso juntos e em ordem no sorteio (`orderByCase`) em `server/services/simulados.ts` — no modelo v2 a questão já carrega todas as suas perguntas (não há "casos" separados)
- [x] T012 `GET /api/simulados/:id` com `serverNow` e respostas já salvas
- [x] T013 `PUT /api/simulados/:id/answers/:questionId`: upsert idempotente, soma de `timeMsDelta`, 409 após o prazo, validação de `choiceId`, guardrail no texto
- [x] T014 `POST /api/simulados/:id/finish`: pontuação + ledger em `db.batch`
- [x] T015 Tornar o finish à prova de concorrência (`UPDATE … WHERE finished_at IS NULL RETURNING`), zerar em branco e manter discursivas com texto como pendentes
- [x] T016 `GET /api/simulados/:id/result` com gabarito completo e `byTopic`
- [x] T017 [P] UI de configuração (`src/features/simulado/SimuladoSetupPage.tsx`, protótipo)
- [x] T018 [P] UI do executor com cronômetros, navegador, atalhos e auto-finalização (`src/features/simulado/SimuladoRunnerPage.tsx`, protótipo)
- [x] T019 Hook `useCountdown(deadlineAt, serverNow)` em `src/features/simulado/useCountdown.ts`, ancorado no relógio do servidor — cronômetro no executor ancorado em `serverNow` (offset medido na chegada), auto-finaliza no fim do prazo
- [x] T020 Ligar o executor à API: carregar a tentativa, salvar respostas (debounce de 800 ms para texto, imediato para alternativa), fila de reenvio em `sessionStorage` — `src/features/simulado/runnerBackend.ts`: escolha imediata, texto com debounce de 800 ms, tempo por questão ao navegar, reenvio das falhas (em memória) e indicador "Salvando…"
- [x] T021 Retomar a tentativa ao recarregar (rota `/simulados/:id` busca o estado no servidor) — testado no navegador: recarregar mantém respostas, tempo e gabaritos revelados

## Fase D — US2 Treino com correção imediata (P1)

- [x] T022 `POST /api/simulados/:id/reveal/:questionId` (403 na prova, trava a resposta, `revealed_before_answer`, autocorreção por checklist)
- [x] T023 Filtro por assuntos e tipos no sorteio (já parcial em T010) + teste com discursiva apresentada como objetiva
- [x] T024 [P] UI de revelação imediata (objetiva e discursiva com checklist) no executor (protótipo)
- [ ] T025 Ligar "Pedir dica" e "Explicar com IA" às rotas de IA (spec 005), marcando `used_hint` via `PUT …/answers`

## Fase E — US3 Gabarito, correção posterior e "treinar o que errei" (P2)

- [x] T026 [P] UI do resultado (`src/features/simulado/SimuladoResultPage.tsx`, protótipo)
- [x] T027 `POST /api/simulados/:id/answers/:questionId/grade` (checklist/IA) com recálculo e lançamento `ajuste:correcao` no ledger — checklist; correção por IA fica para a spec 005
- [x] T028 "Treinar o que errei": criar treino a partir dos assuntos com nota < 0,5 (reaproveita `POST /api/simulados`)
- [x] T029 `GET /api/simulados` (histórico paginado) + lista na tela de simulados

## Fase F — US4 Configuração avançada (P3)

- [x] T030 `prioritizeMistakes`: subconsulta com a última resposta por questão com `score < 0.5`, completando com sorteio
- [x] T031 Teste de escopo: "só as minhas" nunca traz terceiros; "comunidade" nunca traz questões privadas de terceiros
- [ ] T032 Job (cron Vercel diário) que marca como `abandonado` as tentativas em andamento há mais de 24 h

## Fase G — Polimento

- [ ] T033 [P] Acessibilidade: `aria-live` no cronômetro (avisos em 5 min e 1 min), foco ao trocar de questão, contraste AA
- [ ] T034 [P] Teste E2E (Playwright) prova completa: criar → responder → expirar → resultado
- [ ] T035 [P] Métricas: tempo de criação do simulado (SC-003) no log estruturado
- [x] T036 Remover `src/mocks/*` do fluxo de simulados (manter só para Storybook/demos) — o store mock segue só no modo protótipo (dev sem API), atrás de `localBackend`

## Definição de pronto

- Todos os cenários de aceite de US1–US2 passam (manual + automatizado). US3 passa antes do fechamento da Fase 1.
- SC-001 e SC-002 cobertos por testes automatizados no CI.
- `npm run check` (typecheck + lint + vitest) verde.
- Executor validado em 375 px e só com teclado.
- Pontuação do resultado = valor gravado no `points_ledger` (SC-006).
- Spec, plano e contrato atualizados se a implementação divergir.
