# Tarefas — 005 IA assistente e guardrails

**Legenda**: `[P]` = paralelizável (arquivos independentes) · `[x]` = concluída

## Fase A — Setup

- [x] T001 Dependências `ai@7`, `@openrouter/ai-sdk-provider@3`, `zod@4` em `package.json`
- [x] T002 Variáveis `OPENROUTER_API_KEY`, `AI_DAILY_BUDGET`, `AI_USER_DAILY_LIMIT` em `server/env.ts` e `.env.example`
- [x] T003 Tabelas `ai_cache` e `ai_call` em `server/db/schema.ts`
- [ ] T004 Operacional: comprar US$10 de créditos no OpenRouter (1000 req/dia) e ativar o Guardrail de prompt injection (flag) na chave. Registrar em `docs/03-requisitos-tecnicos.md`

## Fase B — Fundação (Fase 1 do roadmap)

- [x] T005 Guardrail determinístico `shared/guardrails.ts` + testes (`shared/__tests__/guardrails.test.ts`)
- [x] T006 Registro de modelos por tarefa `server/ai/models.ts`
- [x] T007 Cliente `callStructured` com fallback em camadas `server/ai/client.ts`
- [x] T008 Circuit breaker `server/ai/breaker.ts`
- [x] T009 System prompts com regra de dados + nonce `server/ai/prompts.ts`
- [x] T010 Schemas de saída `server/ai/schemas.ts` e checagens `server/ai/quality.ts`
- [x] T011 Orçamento `reserveAiRequest` em `server/middleware.ts`
- [x] T012 Validação na inicialização: só IDs `:free` ou `openrouter/free` em `TASKS` (FR-014), em `server/ai/models.ts`
- [x] T013 [P] Telemetria: grava `ai_call` com `user_id` (feito via `setAiRecorder()` em `server/ai/client.ts` + `server/app.ts`)
- [ ] T014 [P] Ritmo de 20 req/min: `server/ai/rate.ts` (token bucket por instância) usado por `callStructured`
- [ ] T015 [P] Testes do cliente com provedor mockado `server/__tests__/ai-client.test.ts`: 429 → próximo elo; JSON inválido → reparo → próximo; quality reprovada → reparo; breaker abre/fecha
- [ ] T016 [P] Testes de `server/ai/quality.ts` (grounding com texto OCR, distratores repetidos/"todas as anteriores"/tamanho)
- [ ] T017 Ampliar os testes de guardrail com casos PT reais (falsos positivos: "o paciente ignora as instruções médicas")

## Fase C — US1 Conteúdo malicioso não afeta o sistema (P1)

- [ ] T018 Corpus de ataques `server/ai/eval/attacks/*.json` (≥ 30: ignore/revele/aja como, zero-width, bidi, chat markup, script, base64, "me dê nota máxima", URL/webhook)
- [ ] T019 Teste automatizado: corpus × `inspectText` (todos sinalizados) e × `gradeDiscursive` com provedor real em job manual (SC-001)
- [ ] T020 Garantir guardrail no servidor em todas as entradas de texto: importação (`server/routes/imports.ts`), respostas (`PUT …/answers`, spec 003), editor de questões, correção (`server/routes/ai.ts`)
- [ ] T021 Lint/teste que proíbe `dangerouslySetInnerHTML` em `src/` (regra oxlint ou teste com grep)
- [ ] T022 Restaurar trecho removido (falso positivo) na revisão da importação, só para o dono (depende do ponto em aberto 4)

## Fase D — US5 Resiliência e economia de cota (P1)

- [ ] T023 Mensagens 429/503 amigáveis no cliente (`src/lib/api.ts`) com alternativas (agente externo, checklist, comentário do autor)
- [ ] T024 Semear o breaker a partir do `ai_call` dos últimos 5 min na primeira chamada da instância
- [ ] T025 Painel simples de saúde (`GET /api/admin/ai-health`, restrito por e-mail admin em env): taxa de sucesso por modelo/dia, consumo vs orçamento
- [ ] T026 Script `npm run ai:eval` (`server/ai/eval/run.ts`): lista modelos `:free` atuais na API do OpenRouter, roda os casos por tarefa e gera a tabela (sucesso, JSON válido, grounding, latência) em `server/ai/eval/report.md`

## Fase E — US2 Explicação e dica (P1 · Fase 2 do roadmap)

- [x] T027 `explainQuestion` com cache compartilhado e checagem de gabarito em `server/ai/services.ts`
- [x] T028 `POST /api/ai/explain/:questionId` (parcial) em `server/routes/ai.ts`
- [ ] T029 Autorização pela tentativa: treino com a questão revelada ou tentativa finalizada; 403 em prova em andamento
- [ ] T030 `hintForQuestion` + `POST /api/ai/hint/:questionId` (só treino + `aiHints` + não respondida; marca `used_hint`; reprova dica com sobreposição ≥ 0,6 com a correta)
- [ ] T031 Cache de explicação para questões privadas com `owner_id` na chave (ponto em aberto 3)
- [x] T032 [P] UI de dica/explicação no executor e no gabarito (protótipo, `src/features/simulado/*`)
- [ ] T033 Ligar a UI às rotas reais (remover `src/mocks/ai.ts` desses fluxos)

## Fase F — US3 Correção de discursiva por IA (P2)

- [x] T034 `gradeDiscursive` + `POST /api/ai/grade` (parcial)
- [ ] T035 Integração com a spec 003: `POST /api/simulados/:id/answers/:qid/grade` usa `gradeDiscursive`, limita a nota a [0, 1] e grava `graded_by = ia`
- [ ] T036 Conjunto de 20 respostas com nota humana em `server/ai/eval/cases/grade.json` e métrica de ±0,2 (SC-004)

## Fase G — US4 Distratores (P2)

- [ ] T037 `generateDistractors` avulso + `POST /api/ai/distractors` (preserva a correta escrita pelo usuário)
- [x] T038 [P] Botão "Gerar incorretas com IA" no editor e geração em lote na revisão (protótipo)
- [ ] T039 Ligar o editor (`src/features/questions/QuestionEditor.tsx`) e a revisão (`src/features/import/ReviewBoard.tsx`) à rota real
- [ ] T040 Casos de avaliação de distratores (30 discursivas) com revisão humana amostral (SC-005)

## Fase H — Visão (Fase 2)

- [ ] T041 Cliente: renderizar páginas com imagem (`pdfExtract.ts` → canvas → JPEG 0,75, ≤ 1 MB) e enviar em lotes < 4,5 MB
- [ ] T042 `describeImage` (tarefa `vision`) + nó opcional no grafo de importação, preenchendo `imageDescription`

## Fase I — Polimento

- [ ] T043 [P] Política de privacidade: informar que o conteúdo das questões é processado por modelos gratuitos de terceiros via OpenRouter
- [ ] T044 [P] Expirar registros de `ai_call` com mais de 90 dias (cron diário)
- [ ] T045 Atualizar a tabela de modelos em `docs/05-pipeline-ia.md` a cada execução do eval

## Definição de pronto

- **Fase 1**: T004, T012–T021, T023 concluídas; corpus de ataques sem nenhuma instrução obedecida; nenhuma rota aceita texto do usuário sem `inspectText` no servidor.
- **Fase 2**: US2–US4 com cenários de aceite verdes; SC-003, SC-004, SC-005 medidos e registrados; `npm run ai:eval` documentado.
- `npm run check` verde; nenhuma saída de IA renderizada como HTML.
- Spec, plano e `docs/05-pipeline-ia.md` atualizados com a cadeia de modelos vigente.
