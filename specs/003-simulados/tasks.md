# Tarefas — 003 Simulados

**Legenda**: `[P]` = paralelizável (arquivos independentes) · `[x]` = concluída

## Fase A — Setup

- [x] T001 Tipos de domínio `SimuladoConfig`, `AnswerRecord`, `SimuladoAttempt` em `shared/domain.ts`
- [x] T002 Regras de pontuação `scoreQuestion`/`scoreSimulado` em `shared/scoring.ts` + testes em `shared/__tests__/scoring.test.ts`
- [x] T003 Tabelas `attempt`, `attempt_answer`, `points_ledger` em `server/db/schema.ts`
- [ ] T004 Adicionar `attempt.status` (enum `em_andamento|finalizado|abandonado`) e `attempt_answer.presented_as` em `server/db/schema.ts` e gerar a migração (`npm run db:generate`)

## Fase B — Fundação

- [ ] T005 [P] Mover `presentAs()` de `src/mocks/model.ts` para `shared/simulado.ts` e criar `autoTimeLimitMin(questions)` e `orderByCase(questions)` — **parcial**: `presentAs` e `autoTimeLimitMin` já em `shared/simulado.ts` com testes; falta `orderByCase`
- [ ] T006 [P] Testes de `shared/simulado.ts` em `shared/__tests__/simulado.test.ts`: conversão discursiva→objetiva, tempo automático (mín. 5), ordenação a/b/c dentro do caso
- [ ] T007 Serializadores `toPublicQuestion()` (sem gabarito) e `toResultQuestion()` em `server/services/simulados.ts`
- [ ] T008 Teste de contrato: nenhuma rota de tentativa em andamento expõe `correct|explanation|expectedAnswer|keyPoints` (`server/__tests__/simulados.contract.test.ts`)
- [ ] T009 [P] Cliente de API tipado em `src/lib/api.ts` (`hc<AppType>` ou fetch + zod) com tratamento de 401/409/422/429

## Fase C — US1 Modo prova (P1)

- [x] T010 `POST /api/simulados` com sorteio, prova forçando `reveal=final`/`aiHints=false` e `deadlineAt` (+15 s) em `server/routes/simulados.ts`
- [ ] T011 Manter subitens do mesmo caso juntos e em ordem no sorteio (`orderByCase`) em `server/services/simulados.ts`
- [ ] T012 `GET /api/simulados/:id` com `serverNow` e respostas já salvas
- [ ] T013 `PUT /api/simulados/:id/answers/:questionId`: upsert idempotente, soma de `timeMsDelta`, 409 após o prazo, validação de `choiceId`, guardrail no texto
- [x] T014 `POST /api/simulados/:id/finish`: pontuação + ledger em `db.batch`
- [ ] T015 Tornar o finish à prova de concorrência (`UPDATE … WHERE finished_at IS NULL RETURNING`), zerar em branco e manter discursivas com texto como pendentes
- [ ] T016 `GET /api/simulados/:id/result` com gabarito completo e `byTopic`
- [x] T017 [P] UI de configuração (`src/features/simulado/SimuladoSetupPage.tsx`, protótipo)
- [x] T018 [P] UI do executor com cronômetros, navegador, atalhos e auto-finalização (`src/features/simulado/SimuladoRunnerPage.tsx`, protótipo)
- [ ] T019 Hook `useCountdown(deadlineAt, serverNow)` em `src/features/simulado/useCountdown.ts`, ancorado no relógio do servidor
- [ ] T020 Ligar o executor à API: carregar a tentativa, salvar respostas (debounce de 800 ms para texto, imediato para alternativa), fila de reenvio em `sessionStorage`
- [ ] T021 Retomar a tentativa ao recarregar (rota `/simulados/:id` busca o estado no servidor)

## Fase D — US2 Treino com correção imediata (P1)

- [ ] T022 `POST /api/simulados/:id/reveal/:questionId` (403 na prova, trava a resposta, `revealed_before_answer`, autocorreção por checklist)
- [ ] T023 Filtro por assuntos e tipos no sorteio (já parcial em T010) + teste com discursiva apresentada como objetiva
- [x] T024 [P] UI de revelação imediata (objetiva e discursiva com checklist) no executor (protótipo)
- [ ] T025 Ligar "Pedir dica" e "Explicar com IA" às rotas de IA (spec 005), marcando `used_hint` via `PUT …/answers`

## Fase E — US3 Gabarito, correção posterior e "treinar o que errei" (P2)

- [x] T026 [P] UI do resultado (`src/features/simulado/SimuladoResultPage.tsx`, protótipo)
- [ ] T027 `POST /api/simulados/:id/answers/:questionId/grade` (checklist/IA) com recálculo e lançamento `ajuste:correcao` no ledger
- [ ] T028 "Treinar o que errei": criar treino a partir dos assuntos com nota < 0,5 (reaproveita `POST /api/simulados`)
- [ ] T029 `GET /api/simulados` (histórico paginado) + lista na tela de simulados

## Fase F — US4 Configuração avançada (P3)

- [ ] T030 `prioritizeMistakes`: subconsulta com a última resposta por questão com `score < 0.5`, completando com sorteio
- [ ] T031 Teste de escopo: "só as minhas" nunca traz terceiros; "comunidade" nunca traz questões privadas de terceiros
- [ ] T032 Job (cron Vercel diário) que marca como `abandonado` as tentativas em andamento há mais de 24 h

## Fase G — Polimento

- [ ] T033 [P] Acessibilidade: `aria-live` no cronômetro (avisos em 5 min e 1 min), foco ao trocar de questão, contraste AA
- [ ] T034 [P] Teste E2E (Playwright) prova completa: criar → responder → expirar → resultado
- [ ] T035 [P] Métricas: tempo de criação do simulado (SC-003) no log estruturado
- [ ] T036 Remover `src/mocks/*` do fluxo de simulados (manter só para Storybook/demos)

## Definição de pronto

- Todos os cenários de aceite de US1–US2 passam (manual + automatizado). US3 passa antes do fechamento da Fase 1.
- SC-001 e SC-002 cobertos por testes automatizados no CI.
- `npm run check` (typecheck + lint + vitest) verde.
- Executor validado em 375 px e só com teclado.
- Pontuação do resultado = valor gravado no `points_ledger` (SC-006).
- Spec, plano e contrato atualizados se a implementação divergir.
