# Tarefas — 002 Importação de questões

**Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

Legenda: `[P]` = paralelizável (arquivos independentes) · `[x]` = concluída

Pré-requisito: spec 001 (sessão, `src/lib/api.ts`) na Fundação.

## Fase 1 — Setup

- [x] T001 Instalar `pdfjs-dist`, `@dnd-kit/core`, `zod`, `ai`, `@openrouter/ai-sdk-provider` (`package.json`)
- [x] T002 Worker do pdf.js via `?url` e import dinâmico (`src/features/import/pdfExtract.ts`, `src/features/import/ImportPage.tsx`)
- [x] T003 `maxDuration: 300` para `api/index.ts` (`vercel.json`)
- [x] T004 Criar chave OpenRouter, comprar US$10 de créditos (1000 req/dia), ativar o Guardrail "Prompt injection" em modo flag e configurar `OPENROUTER_*` e `AI_*` na Vercel (`.env.example` já documenta) — feito em 2026-11-20: US$10 de créditos, guardrail de prompt injection em modo Flag na chave `deus-provera`, `OPENROUTER_*` na Vercel (`AI_*` usam os padrões: 900/dia global, 200/dia por usuário)

## Fase 2 — Fundação (compartilhado + pipeline)

- [x] T005 Contrato v1 com zod, `LIMITS` e `parseImportText` tolerante a ` ```json ` (`shared/schemas/import.ts`)
- [x] T006 Guardrail determinístico + `wrapUntrusted` (`shared/guardrails.ts`)
- [x] T007 Segmentador determinístico + `reflow` + `heuristicKeyPoints` (`shared/segmenter.ts`)
- [x] T008 Prompt do agente externo (`shared/prompts/external-agent.ts`)
- [x] T009 Testes de contrato, guardrail e segmentador (`shared/__tests__/guardrails.test.ts`, `shared/__tests__/import-and-segmenter.test.ts`)
- [x] T010 Tabelas `import_job`, `area`, `discipline`, `question_group`, `question_case`, `question`, `alternative`, `ai_call` (`server/db/schema.ts`)
- [x] T011 `StateGraph` com arestas condicionais e `runUntil` com prazo (`server/ai/graph.ts`)
- [x] T012 Cliente de IA com fallback em 3 camadas e circuit breaker (`server/ai/client.ts`, `server/ai/breaker.ts`, `server/ai/models.ts`)
- [x] T013 Prompts, schemas de saída e checagens de qualidade (`server/ai/prompts.ts`, `server/ai/schemas.ts`, `server/ai/quality.ts`)
- [x] T014 Grafo de importação com fallbacks (`server/ai/pipelines/import-graph.ts`)
- [x] T015 Telemetria: gravar cada `AttemptLog` em `ai_call` com `user_id` e tarefa — feito via `setAiRecorder()` em `server/ai/client.ts`, instalado em `server/app.ts` (sem arquivo `telemetry.ts` separado). O orçamento em `server/middleware.ts` depende disso.
- [x] T016 [P] Validação: se `alternativas` existir em qualquer tipo, exigir ≥ 2 e exatamente 1 correta (`shared/schemas/import.ts`) + teste
- [x] T017 [P] `content_hash`: normalização + SHA-256 (`shared/content-hash.ts`) + testes (em `shared/__tests__/question-schema.test.ts`)
- [ ] T018 Testes do grafo com modelos mockados: caminho feliz, reparo, troca de modelo, todos falhando → rascunhos = blocos (SC-003) (`server/__tests__/import-graph.test.ts`)
- [ ] T019 [P] Testes de `checkGrounding` e `checkDistractors` (`server/__tests__/quality.test.ts`)

## Fase 3 — US1 Agente externo (P1)

- [x] T020 Painel "Usar meu agente de IA": copiar prompt, colar, aviso de guardrail, erros de validação (`src/features/import/ImportPage.tsx` › `AgentPanel`)
- [x] T021 JSON v2 → rascunhos + cards (`src/features/import/drafts.ts` › `draftsFromImportFile`)
- [x] T022 Aceitar vários blocos ` ```json ` colados de uma vez e unir as questões (`shared/schemas/import.ts` › `parseImportText`) + teste
- [x] T023 `POST /api/imports` com `source: agente_externo` revalidando no servidor. O cliente cria o job ao salvar e reabre a revisão pelo `payload` do job (`src/features/import/commit.ts`, `ImportPage.tsx`)
- [x] T024 Commit atômico: findOrCreate de área/disciplina por slug, `question_group` por card, `question_case` por `caso_id`, `question` (com `case_order`, `content_hash`), `alternative` (com `position`), deduplicação e idempotência via `import_job.commit_result` (`server/services/import-commit.ts`, `server/routes/imports.ts` › `/:id/commit`, `server/db/schema.ts`)
- [x] T025 `visibility` por questão no commit (padrão `privada`; a tela aplica a escolha "Compartilhar com a comunidade" a todas) (`shared/schemas/import-commit.ts`)
- [x] T026 Teste de integração: importar o JSON de exemplo duas vezes → 0 duplicatas (SC-007) (`server/__tests__/import-commit.db.test.ts`, `import-routes.db.test.ts` — `npm run test:db`)
- [x] T027 Trocar `commitImport` do store mock pela chamada real e exibir `{ saved, duplicates }` (`src/features/import/ImportPage.tsx`, `commit.ts`; o store mock segue só no modo protótipo)
- [x] T062 Prompt do agente externo aproveita as informações de organização do material (índice/temas, títulos de seção, texto-base compartilhado, gabarito em outra página) para o assunto e registra em `origem.observacoes` (FR-R5) (`shared/prompts/external-agent.ts`, `docs/prompts/prompt-agente-externo.md`) + teste (`shared/__tests__/external-agent-prompt.test.ts`)

## Fase 4 — US2 PDF com IA (P1)

- [x] T028 Extração local com detecção de imagens e escaneados (`src/features/import/pdfExtract.ts`)
- [x] T029 Painel de PDF com resumo, aviso de imagens, aviso de guardrail, texto extraído e estimativa de chamadas (`src/features/import/ImportPage.tsx` › `PdfPanel`)
- [x] T030 Rotas `POST /api/imports` (pdf_ia), `POST /:id/run`, `GET /:id` (`server/routes/imports.ts`)
- [x] T031 Hook `useImportJob`: cria job, chama `/run` em loop (até `revisao`/`falhou`/429), mostra o nó atual (GET a cada 4 s durante o `/run`), permite retomar o job `processando` salvo no navegador (`src/features/import/useImportJob.ts`, fluxo em `src/features/import/importJob.ts`, tela em `src/features/import/JobProgress.tsx`) + teste de ponta a ponta cliente ↔ rota ↔ grafo (`src/features/import/__tests__/importJob.test.ts`)
- [x] T032 Com sessão real, o PDF vai pelo job real (`draftsFromServerJob` monta a revisão com os cards e sinalizações da IA); `runMockPipeline`/`classifyQuestion` ficam só no modo protótipo sem API (`src/features/import/ImportPage.tsx`, `src/features/import/drafts.ts`)
- [x] T061 Estruturação com até 3 lotes em paralelo por passo do grafo (mesmo nº de requisições, ~1/3 do tempo; cota esgotada no meio do passo processa só os lotes reservados) (`server/ai/pipelines/import-graph.ts` › `STRUCTURE_PARALLEL`, `structureBatch`; testes em `server/__tests__/structure-parallel.test.ts`)
- [x] T033 Classificar em lotes de até 20 questões e mesclar os grupos por área/disciplina/assunto (`server/ai/pipelines/import-graph.ts` › `classify`, `mergeClassification`; testes em `server/__tests__/classify.test.ts`)
- [ ] T034 Dividir no cliente textos > 4 MB em vários jobs e truncar páginas > 60.000 caracteres com aviso (`src/features/import/useImportJob.ts`) — parcial (2026-11-20): `pdfJobPayload()` já corta em 60.000 caracteres por página, mas sem aviso; a divisão em vários jobs não existe
- [x] T035 Lista "Importações não salvas" (processando ou em revisão) na página de importação (`GET /api/imports`, `server/routes/imports.ts`, `src/features/import/ImportPage.tsx` › `OpenImports`)
- [x] T063 **Remover** uma importação não salva pela lista (T035): lixeira com confirmação na linha; `DELETE /api/imports/:id` marca `cancelada` e apaga o `state` (idempotente, 409 se já salva); `/run` e `/images` em curso não regravam um job removido (`server/routes/imports.ts`, `src/features/import/ImportPage.tsx` › `OpenImports`; teste em `server/__tests__/import-routes.db.test.ts`; contrato em [contracts/api-imports.md](./contracts/api-imports.md))
- [x] T064 Guia do documento (FR-018a): `shared/document-guide.ts` (título/disciplina, instruções, lista de temas por questão) no nó `segment` (capa não vira questão — `skipPreamble`), classificação sem IA pela lista no nó `classify` (`classifyByGuide`), guia como pista à IA e fallback na disciplina indicada; painel "Guia do documento" + avisos na revisão (`GET /api/imports/:id` › `guide`; `src/features/import/ReviewBoard.tsx`). Testes: `shared/__tests__/document-guide.test.ts`, `server/__tests__/classify-guide.test.ts`. `npm run eval:import` sem mudança (docs/10)
- [x] T065 Cota diária do OpenRouter (429 "free-models-per-day") = `AiQuotaExhaustedError`: pausa `structure`/`classify` com checkpoint e 429 sugerindo o agente próprio; distratores param com aviso; `/images`, simulado e editor respondem 429. `/run` passa a gravar o ÚLTIMO checkpoint no 429 (antes regravava o estado do início da chamada). Testes: `ai-client.test.ts`, `structure-parallel.test.ts`, `classify-guide.test.ts`
- [x] T066 Tabelas, gráficos, fórmulas e POP-Q na importação (FR-R6): `popqLayoutToLine` (quadro em texto solto → linha canônica) em `fullTextWithImages` e no `fullText` do cliente; `tablesForDisplay` (linha POP-Q → grade Markdown; `[Imagem p. N: a | b / c | d]` → tabela com legenda) nos rascunhos da IA, do fallback e do protótipo; avaliação lê a grade de volta (`popqGridToLine`); prompts `STRUCTURE_SYSTEM`, `VISION_SYSTEM` e do agente externo pedem tabelas, valores de gráficos e fórmulas/funções em Unicode (`shared/tables.ts`, `server/ai/prompts.ts`, `server/ai/pipelines/import-graph.ts`, `src/features/import/drafts.ts`, `pdfExtract.ts`, `scripts/eval-import.ts`) + testes (`shared/__tests__/tables.test.ts`, `server/__tests__/structure-parallel.test.ts`, `importJob.test.ts`). Avaliação em docs/10 §9
- [x] T067 Prompt do agente externo completa os dois formatos (FR-R7): regra 5 obrigatória — discursiva ganha alternativas geradas, objetiva ganha `resposta_esperada` + `pontos_chave`; exemplo com uma pergunta de cada (`shared/prompts/external-agent.ts`, `docs/prompts/prompt-agente-externo.md`) + teste (`shared/__tests__/external-agent-prompt.test.ts`)
- [x] T068 Enunciado nunca vazio (FR-R9): regra no prompt do agente externo + `fillBlankStem` no leitor do contrato v2 (`shared/prompts/external-agent.ts`, `shared/schemas/import.ts`) + testes (`import-and-segmenter.test.ts`, `external-agent-prompt.test.ts`). `npm run eval:import` sem mudança
- [x] T069 Banco de questões (FR-R10): filtros por disciplina/assunto com `ChipPicker` compartilhado com o simulado (`src/components/ChipPicker.tsx`, `src/lib/text.ts`), clique abre a edição, editor em duas colunas com lista de perguntas em cards numerados (`src/features/questions/QuestionBankPage.tsx`, `QuestionEditor.tsx`, `questionInput.ts`, `src/components/ui.tsx` › `Modal xl`)
- [x] T070 Completar formatos com IA (FR-R8): `shared/completeness.ts` (+ teste), `POST /api/ai/answers` (tarefa `answers`, `ANSWERS_SYSTEM`, `checkWrittenAnswers`; `server/__tests__/written-answers.test.ts`), `useWrittenAnswers` + `runAiBatches` (`src/lib/ai.ts`), fluxo gerar → revisar → salvar no banco (`CompleteFormats.tsx`) e botão "Gerar discursiva" na revisão (`ReviewBoard.tsx`). Validado no navegador com API simulada (sem banco); **não testado contra o OpenRouter real**
- [x] T036 Mensagem de cota esgotada (429) sugerindo o agente externo, com "Tentar continuar" do checkpoint (`src/features/import/JobProgress.tsx`)
- [ ] T037 Conjunto de avaliação PT-BR (20 blocos dos PDFs de exemplo com gabarito estruturado) + script `npm run ai:eval` (`server/ai/eval/`, `package.json`) para SC-002/SC-004

## Fase 5 — US3 Revisão em cards (P1)

- [x] T038 `ReviewBoard`: cards, contagens, flags, drag-and-drop (ponteiro + teclado), "Mover para…", editar/criar/remover card, descartar e editar questão (`src/features/import/ReviewBoard.tsx`)
- [x] T039 Editor de questão compartilhado (`src/features/questions/QuestionEditor.tsx`)
- [x] T040 Itens inválidos bloqueiam a confirmação, com lista de problemas (Editar questão/card) e a opção explícita "Tirar N questões com problema da importação" (`src/features/import/ReviewBoard.tsx`)
- [ ] T041 Anúncios `aria-live` ao mover questões e instruções de teclado do dnd-kit em pt-BR (`src/features/import/ReviewBoard.tsx`)
- [x] T042 Persistir o rascunho da revisão no `import_job` (autosave) para não perder edições ao recarregar (`PATCH /api/imports/:id/draft`, `server/routes/imports.ts`) — `PATCH /api/imports/:id/draft` 2 s após cada edição; reabrir pela lista de importações não salvas (T035) restaura as edições; o JSON do agente cria o job já na revisão

## Fase 6 — US4 Distratores com IA (P2)

- [x] T043 Botões "Gerar incorretas com IA" (por questão) e "Gerar alternativas p/ N discursivas" (lote) — simulados (`src/features/questions/QuestionEditor.tsx`, `src/features/import/ReviewBoard.tsx`, `src/mocks/ai.ts`)
- [x] T044 Nós `plan-distractors`/`distractors` com `checkDistractors` (`server/ai/pipelines/import-graph.ts`)
- [x] T045 `POST /api/ai/distractors` (até 6 questões por chamada, orçamento, preserva a correta informada) (`server/routes/ai.ts`) — com `reserveAiRequest` e 503 quando a IA está indisponível (spec 005 T037)
- [x] T046 Ligar o editor e o lote ao endpoint real, com tratamento de 503/429 (`src/features/questions/QuestionEditor.tsx`, `src/features/import/ReviewBoard.tsx`) — via `useDistractors()` (`src/lib/ai.ts`); a IA simulada fica só no modo protótipo (selo DEMO)

## Fase 7 — US5 Cadastro manual (P2)

- [x] T047 Painel manual com área/disciplina/assunto do lote e lista de questões (`src/features/import/ImportPage.tsx` › `ManualPanel`)
- [x] T048 Enviar o lote manual pelo mesmo commit (`source: manual`) (`server/routes/imports.ts`, `src/features/import/commit.ts`)
- [x] T055 Contrato zod da questão v2 compartilhado com o editor (`shared/schemas/question.ts`) + testes (`shared/__tests__/question-schema.test.ts`)
- [x] T056 `/api/questions`: listar (minhas/comunidade/todas, filtros), obter, criar manual, editar (substituição completa), excluir (soft-delete) e `/api/taxonomy` (`server/routes/questions.ts`, `server/services/questions.ts`, `server/routes/taxonomy.ts`) — contrato em [contracts/api-questions.md](./contracts/api-questions.md)
- [x] T057 Banco de questões lendo da API com cliente Hono RPC + TanStack Query: "Nova questão" (Área › Disciplina › Assunto + editor), editar e excluir com confirmação (`src/lib/api.ts`, `src/features/questions/QuestionBankPage.tsx`, `src/features/questions/QuestionEditor.tsx`)
- [x] T058 Seed idempotente da taxonomia global (áreas e disciplinas comuns) (`server/db/seed.ts`, `npm run db:seed`)

## Fase 8 — Polimento e Fase 2 (visão, guardrail LLM)

- [x] T049 [P] Localizar as imagens úteis (CTM + recorte do pdf.js), marcar `[[imagem pN-k]]` no texto e renderizar só o RECORTE em JPEG (lado ~1400 px, 1,5–4×, qualidade 0,75), em lotes ≤ 3 e < 4,5 MB; prévia "Ver recortes" na tela (`shared/page-images.ts`, `src/features/import/pdfExtract.ts`, `src/features/import/pageImages.ts`, `src/features/import/ImportPage.tsx`) + testes (`shared/__tests__/page-images.test.ts`)
- [x] T050 `POST /api/imports/:id/images` + nó `vision` (cadeia `vision`, 2ª tentativa individual, guardrail na transcrição) antes de `segment`, inserindo `[Imagem p. N: …]` na questão e preenchendo `tem_imagem`/`descricao_imagem` (`server/routes/imports.ts`, `server/ai/pipelines/import-graph.ts`, `server/ai/pipelines/vision.ts`, `server/ai/client.ts` com partes de imagem) + testes (`server/__tests__/vision.test.ts`)
- [x] T059 Medir a visão: `npm run eval:import -- --vision` (recortes em Node com `@napi-rs/canvas`, mesmo nó do grafo, métricas de questões com imagem e POP-Q ponto a ponto) e registrar em docs/10 §7 (`scripts/eval-import.ts`, `scripts/pdf-images-node.ts`)
- [x] T060 No hook `useImportJob` (T031): criar o job com `pdfJobPayload()`, chamar `renderPageImages()` + `uploadPageImages()` antes do loop de `/run`, mostrar o progresso da visão (recortes e lotes) e tratar 429 (seguir sem visão); opção "Transcrever as N imagens com IA" na tela de PDF (`src/features/import/importJob.ts`, `src/features/import/useImportJob.ts`, `src/features/import/ImportPage.tsx`). **Não testado ao vivo** contra Neon + login Google (credenciais ainda não configuradas no `.env`)
- [ ] T051 [P] Conjunto de ataques de injeção embutidos em PDF/JSON + teste de que a saída não muda (SC-005) (`server/__tests__/injection.test.ts`)
- [x] T052 [P] Teste E2E do fluxo agente externo → revisão → salvar (Playwright) (`e2e/import.spec.ts`) — `e2e/importacao.spec.ts`: agente externo → revisão → salvar → banco; reimportar = duplicata. Com `E2E_AI=1`, os PDFs de exemplo pela tela com a IA real
- [ ] T053 Medir SC-001 (tempo de extração) e SC-002 (requisições por PDF) e registrar em `docs/05-pipeline-ia.md` — parcial: tempos e requisições por lote dos dois PDFs já estão em docs/10 §5–§8; falta consolidar SC-001/SC-002 no docs/05
- [ ] T054 Remover `runMockPipeline`, `classifyText` e `aiGenerateDistractors` mock quando os endpoints reais estiverem ativos (`src/mocks/ai.ts`)

## Fase 9 — US6 Questões e gabarito em PDFs separados (P1) — 2026-11-22

- [x] T071 Segmentador: "Estação N.N — Título" (título fora do enunciado) e "Caso N" (só sem QUESTÃO/Estação), "Parte N" como pergunta (também no meio da linha; etapa só com dados vai para a seguinte), títulos de tema "1A — Tema" como seção, "Resposta comentada" dentro da questão, modo só-questões (`answers: false`) e modo gabarito (`key`); "Fonte: …, Questão 27" não abre questão (`shared/segmenter.ts`)
- [x] T072 Guia do documento: legenda de temas por código ("1A — Miomas — 17 estações" → `themes`), "Temas" como título de legenda, instrução na mesma linha ("Como treinar: …") e capa antes da 1ª "Estação" (`shared/document-guide.ts`)
- [x] T073 `shared/answer-key.ts`: `detectDocumentRole`, `findAnswerSection` (gabarito no fim do PDF), `parseAnswerKey` (cabeçalhos, lista numerada, grade de letras), `linkAnswers`/`applyEntry` (número com k-ésima ocorrência, deslocamento, ordem; item por rótulo; objetiva pela letra) e `segmentImport` + testes (`shared/__tests__/answer-key.test.ts`)
- [x] T074 API e grafo: `documents[]` em `POST /api/imports` (400 se inválido), `docs`/`link`/`pendingLink` no estado, nó `segment` com `segmentImport`, nó `link` (tarefa `link`, `:free`, só pares de ids, opcional), `link` em `GET /:id`, classificação pelo tema da seção sem IA, prompt de estruturação com "Resposta (gabarito)" (`server/routes/imports.ts`, `server/ai/pipelines/import-graph.ts`, `server/ai/{models,schemas,prompts}.ts`) + testes sem banco (`server/__tests__/import-link.test.ts`)
- [x] T075 Tela de PDF: vários arquivos (até 5), papel por arquivo sugerido e editável, "Adicionar outro PDF", resumo da ligação antes de processar, recortes de imagem do arquivo certo (`src/features/import/{ImportPage.tsx,pdfSet.ts,pageImages.ts,importJob.ts,pdfExtract.ts}`) + testes (`src/features/import/__tests__/pdfSet.test.ts`)
- [x] T076 Revisão: quadro "Gabarito" (ligadas, sem resposta, respostas sem questão com o texto) e temas do guia (`src/features/import/ReviewBoard.tsx`, `src/features/import/drafts.ts`)
- [x] T077 Agente externo: regra "MAIS DE UM ARQUIVO" no prompt e instrução na tela (`shared/prompts/external-agent.ts`, `docs/prompts/prompt-agente-externo.md`)
- [x] T078 `npm run eval:link` (verificação independente no texto cru do gabarito) e registro em docs/10 §10; `eval:import` passa a usar `segmentImport` (mesmo caminho do nó `segment`) sem mudar as métricas (`scripts/eval-link.ts`, `scripts/eval-import.ts`)
- [ ] T079 Validar ao vivo contra o Neon + IA real (o nó `link` só foi testado com IA simulada; nada foi executado no banco de produção)

## Definição de pronto

- [x] Os três métodos importam e salvam questões reais no Neon, com revisão obrigatória (T023, T027, T048)
- [x] `Unidade II.pdf` e `III UNIDADE.pdf` processados de ponta a ponta com IA real e via agente externo (docs/10 §8; E2E com `E2E_AI=1`)
- [x] Falha total de IA simulada: nenhuma questão perdida (SC-003) (`src/features/import/__tests__/importJob.test.ts`: estruturação indisponível → fallback determinístico)
- [x] Orçamento global e por usuário decrementando via `ai_call`, com 429 tratado na UI (`reserveAiRequest`; T036)
- [x] Reimportação sem duplicatas (SC-007) (T026)
- [ ] Revisão operável por teclado e sem rolagem horizontal em 375 px (SC-008)
- [ ] `npm run check` verde, incluindo T016–T019, T022, T026
- [ ] Contratos em `contracts/` iguais ao comportamento implementado
