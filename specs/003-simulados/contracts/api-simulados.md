# Contrato — API de Simulados (modelo v2)

Base: `/api/simulados`. Todas as rotas exigem sessão (cookie do Better Auth) e respondem `401` sem login. Erros seguem o formato `{ "error": string }`.

Implementação: [`server/routes/simulados.ts`](../../../server/routes/simulados.ts) e [`server/services/simulados.ts`](../../../server/services/simulados.ts). Os tipos e a validação ficam em [`shared/schemas/simulado.ts`](../../../shared/schemas/simulado.ts) (`AttemptView`, `ResultView`, `ItemKey`…). O cliente está em [`src/features/simulado/remote.ts`](../../../src/features/simulado/remote.ts).

**Unidades:**
- A **questão** (enunciado + perguntas) é a unidade de sorteio, de tempo e de marcação "revisar".
- A **pergunta** (`itemId`) é a unidade de resposta e de pontuação (`shared/scoring.ts`).

---

## POST `/api/simulados/preview` — prévia do sorteio

Recebe o mesmo corpo da criação. Responde `{ "available": n, "topics": string[], "withQuestions": { "areaIds": string[], "disciplineIds": string[] }, "kinds": AnswerKind[][], "answerFormat" }`.

| Campo | Conteúdo |
|---|---|
| `available` | Questões elegíveis com os filtros e o formato de resposta (até 500) |
| `topics` | Assuntos disponíveis, ignorando o filtro de assunto |
| `withQuestions` | Áreas e disciplinas com alguma questão na fonte (`scope`), ignorando os filtros de área, disciplina e assunto. A tela só oferece essas |
| `kinds` | O formato de cada pergunta, por questão, na ordem do sorteio (até 100). O cliente fatia pela quantidade escolhida para estimar o tempo, então mexer no seletor de quantidade não dispara requisição |

## POST `/api/simulados` — criar

**Corpo** (`SimuladoConfig`):

```json
{ "mode": "prova", "scope": "minhas_e_comunidade", "areaId": null, "disciplineIds": [], "topics": [],
  "answerFormat": "original", "count": 20, "timeLimitMin": null, "reveal": "final", "aiHints": false, "prioritizeMistakes": false }
```

**Regras**
- **Prova:** o servidor força `reveal = "final"` e `aiHints = false`, e ignora `topics`. Se `timeLimitMin` vier `null`, aplica o tempo automático pelo sorteio real: 2 min por pergunta objetiva e 6 por discursiva, mínimo 5.
- **Escopo:**
  - `minhas` traz só as questões do usuário.
  - `minhas_e_comunidade` soma as **públicas** de outros usuários, nunca as privadas.
- **Elegibilidade** pelo formato de resposta: `shared/simulado.ts` › `isEligible`.
- **`prioritizeMistakes`:** sorteia primeiro as questões com alguma pergunta errada (nota < 0,5) em simulados finalizados.
- **Prazo:** `deadlineAt = startedAt + timeLimitMs + 15 s` de tolerância de rede.
- **Gravação:** cria uma linha em `attempt_question` por questão (posição, tempo e marcação).

**Respostas:**
- `201 { "id", "config", "deadlineAt" }`, onde `config` é a configuração efetiva (com `count` real).
- `400` se a configuração for inválida.
- `422 { "error": "Nenhuma questão com esses filtros e formato de resposta." }`.

## GET `/api/simulados` — histórico

`200 { "items": HistoryItem[] }`, com até 30 itens, os mais recentes primeiro. Cada item: `{ id, mode, status: "em_andamento" | "finalizado", questions, accuracy, points, countsForRanking, startedAt, finishedAt, title }`. Os em andamento aparecem na tela com **continuar**.

## GET `/api/simulados/:id` — tentativa em andamento (`AttemptView`)

```json
{
  "id": "uuid", "config": { "...": "efetiva" }, "status": "em_andamento",
  "startedAt": "…", "deadlineAt": "… | null", "timeLimitMs": 1200000, "serverNow": "…",
  "questions": [{ "id": "uuid", "area": "Medicina", "discipline": "Ginecologia", "topic": "…", "sourceLabel": "QUESTÃO 8",
                  "stem": "…", "hasImage": false, "difficulty": "media", "own": true,
                  "items": [{ "id": "uuid", "label": "a", "prompt": "…", "type": "discursiva", "presentAs": "objetiva",
                              "alternatives": [{ "id": "uuid", "text": "…" }], "keyPointCount": 3 }] }],
  "answers": { "<itemId>": { "choiceId": "uuid", "text": null, "score": null, "usedHint": false, "revealedBeforeAnswer": false, "revealed": false } },
  "keys": { "<itemId>": { "itemId": "…", "alternatives": [{ "id": "…", "correct": true, "explanation": "…" }], "expectedAnswer": "…", "keyPoints": ["…"] } },
  "timeMs": { "<questionId>": 42000 }, "flagged": ["<questionId>"]
}
```

**Sigilo (T008, coberto por teste):**
- Fora de `keys`, nenhuma resposta contém `correct`, `explanation`, `expectedAnswer` ou `keyPoints`.
- Na prova, `keys` é sempre vazio e `score` é `null` até o resultado.
- No treino, `keys` só traz as perguntas já reveladas.
- `presentAs` vem do servidor, porque o cliente não tem o gabarito para calcular o formato.

`serverNow` permite ao cliente acompanhar o relógio do servidor no cronômetro.

**Erros:**
- `404` se a tentativa não existir ou for de outro usuário.
- `409 { "error": "finalizado" }`: o cliente vai para o resultado.

## PUT `/api/simulados/:id/answers/:itemId` — resposta a uma pergunta

**Corpo:** `{ "choiceId"?: uuid | null, "text"?: string | null, "usedHint"?: true }`. A escrita é idempotente e a última vence.

**Regras:**
- `choiceId` precisa ser uma alternativa da pergunta e a pergunta precisa ser objetiva neste simulado; senão `400`.
- `text` só vale para perguntas discursivas. Passa por `inspectText` (guardrail) antes de ser gravado.
- `usedHint` não é permitido na prova (`403`).
- `409` se o tempo acabou (`now > deadlineAt`), se o simulado foi finalizado ou se a pergunta já foi revelada (resposta travada).

**200:** `AnswerView`, sem nota.

## PUT `/api/simulados/:id/questions/:questionId` — tempo e marcação

**Corpo:** `{ "timeMsDelta"?: 0–600000, "flagged"?: boolean }`. `timeMsDelta` é **somado** ao tempo da questão, limitado à duração real da tentativa no servidor.

**200:** `{ "timeMs", "flagged" }`.

## POST `/api/simulados/:id/reveal/:itemId` — revelar no treino (T022)

Só no **treino com `reveal = "imediato"`**; nos outros casos responde `403`.

**Corpo:** `{ "checked"?: boolean[] }`, a autocorreção da discursiva pelos pontos de acerto.

**Regras:**
- Grava `revealed_at` e trava a resposta.
- Sem resposta: `revealedBeforeAnswer = true` e nota 0.
- **Objetiva:** nota 1 ou 0, `gradedBy = "auto"`.
- **Discursiva:**
  - A 1ª chamada devolve a resposta esperada e os pontos de acerto, com nota ainda `null`.
  - A chamada com `checked` grava `score = marcados / total` com `gradedBy = "checklist"`, que vale 50% no ranking.

**200:** `{ "key": ItemKey, "answer": AnswerView }`.

## POST `/api/simulados/:id/finish` — finalizar (T014/T015)

1. Corrige as objetivas, zera as perguntas em branco e mantém as discursivas com texto e sem nota **pendentes** (`score = null`).
2. Calcula o `SimuladoScore`, com o anti-farm de repetição medido nos 7 dias anteriores ao início da tentativa.
3. Grava tudo num único `db.batch`:
   - `UPDATE attempt … WHERE finished_at IS NULL` — só a primeira finalização vale;
   - as notas;
   - o lançamento `simulado:<modo>` no `points_ledger`, com índice único (tentativa, motivo).

   Repetir a chamada devolve o mesmo resultado, sem lançar de novo.

**200:** `{ "id", "base", "timeBonus", "total", "accuracy", "countsForRanking", "pending" }` (`ScoreDetail`, gravado em `attempt.score_detail`).

## GET `/api/simulados/:id/result` — resultado (T016)

Disponível só depois de finalizado; antes disso responde `409`.

**200:** `ResultView`, que é `AttemptView` mais `finishedAt`, `totalTimeMs`, `score` (`ScoreDetail`), as notas de todas as respostas, `keys` com o gabarito de **todas** as perguntas e `byTopic: [{ discipline, topic, items, accuracy }]`.

## POST `/api/simulados/:id/grade/:itemId` — correção posterior (T027)

**Corpo:** `{ "checked": boolean[] }`, a autocorreção pelos pontos de acerto. A correção por IA chega com a spec 005.

**Regras:**
- Só aceita pergunta com resposta e `score = null`. Uma pergunta já corrigida devolve `409`.
- Recalcula o `ScoreDetail` e lança a **diferença** no ranking (`ajuste:correcao:<itemId>`, idempotente).

**200:** `{ "answer", "score": ScoreDetail, "delta" }`.

---

## IA no simulado (spec 005)

A autorização vem da **tentativa**: as rotas genéricas `/api/ai/explain` e `/api/ai/grade` foram removidas.

**Regras comuns:**
- Toda chamada passa por `reserveAiRequest`, o orçamento global e por usuário.
- O conteúdo do aluno vai para o modelo como dado, com `wrapUntrusted`.
- IA indisponível responde `503` com uma alternativa: autocorreção ou comentário do autor.

| Rota | Quando | Resposta |
|---|---|---|
| `POST /:id/hint/:itemId` | Treino com `aiHints`, pergunta ainda não revelada. Na prova ou com dicas desligadas: `403`; já revelada: `409` | `{ hint }`. Marca `used_hint`, e a pergunta vale metade. Dica que entrega a resposta (sobreposição ≥ 0,6) é trocada por uma genérica |
| `POST /:id/explain/:itemId` | Treino com `aiHints` depois de revelar a pergunta, ou simulado finalizado. Antes disso: `403` | `{ hint, perAlternative: [{ id, verdict, why }], summary, cached }`. Usa cache compartilhado (`ai_cache`) e nunca contradiz o gabarito |
| `POST /:id/ai-grade/:itemId` | Discursiva com texto e sem nota: no treino depois de ver a resposta esperada, ou depois de finalizar | `{ answer, matched: boolean[], feedback, score?, delta? }`. Nota em [0, 1] com `graded_by = ia` (vale 100%). Depois de finalizar, lança a diferença no ranking |

Fora do simulado: `POST /api/ai/distractors { items: [{ id, stem, prompt?, expectedAnswer, correct? }] }`.
- Até 6 perguntas por chamada, ou seja, 1 requisição.
- Gera a correta e 4 distratores com explicação. Se o autor já escreveu a correta (`correct`), ela é preservada.
- Usado pelo editor e pela revisão da importação.

## Rotina diária

`GET /api/cron/daily`, chamada pelo Vercel Cron com `Authorization: Bearer <CRON_SECRET>`; sem o segredo responde `503`.
- Fecha como **abandonadas** as tentativas em andamento há mais de 24 h (`abandoned_at`, sem pontos).
- Apaga `ai_call` com mais de 90 dias.

## Ranking e painel (spec 004)

- `GET /api/ranking?periodo=semana|mes|geral&area=<uuid>` → `{ periodo, area, rows: RankingRow[], me: RankingRow | null }`. Com `area`, conta só os lançamentos daquela área, que é a área predominante do simulado.
  - Cada `RankingRow` traz `{ pos, userId, name, image, institution, points, grade, simulados, me }`.
  - `grade` é a nota dos últimos 30 dias, com prova pesando 2; é `null` com menos de 10 respostas.
  - Ordem: pontos, depois simulados no período, depois `userId`.
  - Quem desligou "Aparecer no ranking" só aparece para si mesmo.
- `GET /api/stats/me`: o painel do estudante (`DashboardView` em `server/services/stats.ts`), com:
  - pontos e posição;
  - nota e variação na semana;
  - respondidas, acerto, simulados e provas em 14 dias;
  - tempo médio por questão e sequência de estudo (BRT);
  - minhas questões;
  - mapa por Disciplina › Assunto e o assunto mais fraco (≥ 2 respostas; empate → o mais respondido);
  - atividade de 28 dias e os últimos 10 simulados.

## Testes

`server/__tests__/simulados.db.test.ts` (`npm run test:db`) cobre, contra o Postgres:
- prévia e escopo (T031);
- sigilo do gabarito (T008);
- respostas e alternativa inválida;
- revelação e trava no treino;
- autocorreção;
- finalização idempotente com um lançamento só;
- resultado;
- correção posterior com ajuste no ranking;
- prazo, 404 e 422;
- painel e ranking a partir de simulados reais.
