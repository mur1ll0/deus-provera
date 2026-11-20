# Tarefas — 004 Dashboard e ranking

**Legenda**: `[P]` = paralelizável (arquivos independentes) · `[x]` = concluída

## Fase A — Setup

- [x] T001 Regras de pontuação e `performanceGrade` em `shared/scoring.ts` + testes (`shared/__tests__/scoring.test.ts`)
- [x] T002 Tabelas `points_ledger`, `attempt`, `attempt_answer`, `profile` em `server/db/schema.ts`
- [ ] T003 Seed de desenvolvimento com 12 usuários, 300 respostas e lançamentos em várias semanas (`server/db/seed.ts`)

## Fase B — Fundação

- [ ] T004 [P] `shared/stats.ts`: `periodStart(periodo, now, 'America/Sao_Paulo')` (**já existe** como `rankingPeriodStart` em `shared/simulado.ts`, com testes — mover para `stats.ts`), `computeStreak(daysWithActivity, today)`, `accuracyBand(acc)`
- [ ] T005 [P] Testes em `shared/__tests__/stats.test.ts` (segunda-feira BRT, virada de mês, sequência com e sem atividade hoje, faixas 60/75%)
- [ ] T006 [P] `server/services/anti-farm.ts`: `repeatedRecently(userId, questionIds)` (respostas nos últimos 7 dias) e uso no finish (spec 003, `server/routes/simulados.ts`)
- [ ] T007 Preencher `points_ledger.area_id` na finalização (área predominante; multiárea → rateio)
- [ ] T008 Rate limit de criação de simulados (60/h por usuário) em `server/middleware.ts`

## Fase C — US1 Painel de estatísticas (P1)

- [ ] T009 `server/services/stats.ts`: KPIs (pontos, acerto, respondidas, simulados/provas, tempo médio, minhas questões)
- [ ] T010 `server/services/stats.ts`: nota de desempenho de 30 dias + variação semanal (`performanceGrade`), "—" com < 10 respostas
- [ ] T011 `server/services/stats.ts`: mapa por Disciplina › Assunto, assunto mais fraco (≥ 5 respostas), heatmap de 28 dias (BRT), evolução (10 últimos), recentes (5)
- [ ] T012 `server/routes/me.ts`: `GET /api/me/dashboard` montado em `server/app.ts`
- [x] T013 [P] UI do painel (`src/features/dashboard/DashboardPage.tsx`, protótipo)
- [ ] T014 Hook `useDashboard()` em `src/lib/api.ts` e substituição de `MY_HISTORY`/`TOPIC_PERFORMANCE`/`ACTIVITY_28D` mock
- [ ] T015 Estados vazios (usuário novo) e de carregamento (skeleton) no painel
- [ ] T016 CTA "Treinar pontos fracos" abre `/simulados` com o assunto pré-selecionado (query string `?assunto=`)

## Fase D — US2 Ranking (P1)

- [x] T017 `GET /api/ranking?periodo=` com opt-out em `server/routes/ranking.ts` (parcial)
- [ ] T018 (BRT já corrigido em `server/routes/ranking.ts` via `rankingPeriodStart`) Ajustar filtro `area`, desempate (nota, data, user_id), `limit`
- [ ] T019 Posição do usuário (`rank() over`) em `GET /api/ranking/me` ou no campo `me`
- [ ] T020 [P] Cache de 60 s em `server/services/ranking-cache.ts`
- [x] T021 [P] UI do painel de ranking à direita e da página de ranking (protótipo)
- [ ] T022 Hook `useRanking(periodo, area)` e ligação de `RankingPanel` e `RankingPage` à API; filtro por Área na página

## Fase E — US3 Transparência e integridade (P2)

- [ ] T023 [P] Componente "Como a pontuação é calculada" reutilizável (`src/components/ScoringRules.tsx`) gerado a partir das constantes de `shared/scoring.ts`
- [ ] T024 Testes de fraude em `server/__tests__/scoring-integrity.test.ts`: pontos no corpo, finish duplicado, prazo vencido, farm de questão própria, repetição em 7 dias
- [ ] T025 `PATCH /api/me/profile` + `src/features/profile/ProfilePage.tsx` (nome de exibição, instituição/curso, opt-out do ranking)

## Fase F — Polimento

- [ ] T026 [P] Medir SC-001/SC-002 com a seed grande (`server/db/seed-large.ts`) e registrar o resultado no plano
- [ ] T027 [P] Acessibilidade: tabela de ranking com `<caption>`, heatmap com `title`/descrição textual, cores com rótulo
- [ ] T028 Plano B documentado: tabela `points_daily` se o p95 do ranking passar de 300 ms

## Definição de pronto

- Cenários de aceite de US1 e US2 passam com a seed. US3 antes do fechamento da Fase 1.
- Números do painel batem com as queries de referência (SC-003) em teste automatizado.
- Testes de fraude (T024) verdes no CI.
- `npm run check` verde; painel validado em 375 px e em ≥ 1280 px (ranking à direita).
- Usuário com opt-out ausente das respostas públicas (SC-006).
