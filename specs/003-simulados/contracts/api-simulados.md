# Contrato — API de Simulados

Base: `/api/simulados`. Todas as rotas exigem sessão (cookie do Better Auth) e respondem `401` sem login. Erros seguem o formato `{ "error": string }`.

Tipos referenciados: `SimuladoConfig`, `AnswerRecord` em `shared/domain.ts`.

---

## POST `/api/simulados`

Cria uma tentativa. O servidor sorteia as questões e define o prazo.

**Corpo** (`SimuladoConfig`)
```json
{
  "mode": "prova",
  "scope": "minhas_e_comunidade",
  "areaId": "6b1…",
  "disciplineIds": ["9a2…"],
  "topics": [],
  "types": ["objetiva", "discursiva"],
  "count": 20,
  "timeLimitMin": null,
  "reveal": "final",
  "aiHints": false,
  "prioritizeMistakes": false
}
```

**Regras**
- `mode = "prova"`: o servidor força `reveal = "final"` e `aiHints = false`. Se `timeLimitMin` vier nulo, aplica o tempo automático (2 min por objetiva + 6 min por discursiva, mínimo 5).
- `topics` é ignorado na prova.
- `deadlineAt = startedAt + timeLimitMs + 15 s`.

**Respostas**
- `201` com `{ "id": "uuid", "questionIds": ["uuid", …], "deadlineAt": "ISO-8601 | null", "config": SimuladoConfig }`, onde `config` é a configuração efetiva, depois dos ajustes do servidor.
- `400`: configuração inválida.
- `422`: `{ "error": "Nenhuma questão com esses filtros." }`.

---

## GET `/api/simulados`

Histórico do usuário (paginado).

**Query**: `?cursor=<startedAt ISO>&limit=20`

**200**
```json
{
  "items": [
    { "id": "uuid", "mode": "prova", "status": "finalizado", "questions": 20, "accuracy": 0.8, "points": 612, "startedAt": "…", "finishedAt": "…", "countsForRanking": true }
  ],
  "nextCursor": "… | null"
}
```

---

## GET `/api/simulados/:id`

Tentativa em andamento, pronta para o executor.

**200**
```json
{
  "id": "uuid",
  "config": { "...": "SimuladoConfig efetiva" },
  "status": "em_andamento",
  "startedAt": "…",
  "deadlineAt": "… | null",
  "serverNow": "…",
  "questions": [
    {
      "id": "uuid",
      "presentAs": "objetiva",
      "area": "Medicina", "discipline": "Ginecologia", "topic": "Prolapso genital",
      "case": { "key": "uuid", "context": "Mulher de 80 anos…" },
      "stem": "a) Qual cirurgia…?",
      "imageDescription": null,
      "alternatives": [ { "id": "uuid", "text": "Colpocleise" } ]
    }
  ],
  "answers": { "<questionId>": { "choiceId": "uuid", "text": null, "timeMs": 42000, "flagged": false, "revealed": false } }
}
```

**Garantias de sigilo**
- Na prova em andamento, nenhuma resposta contém `correct`, `explanation`, `expectedAnswer` ou `keyPoints`.
- No treino com `reveal = "imediato"`, o gabarito de uma questão só aparece em `answers[qid].reveal` depois de `POST /reveal/:qid`.
- `serverNow` permite ao cliente corrigir a diferença de relógio (`offset = serverNow - Date.now()`).

**Erros**
- `404`: a tentativa não existe ou é de outro usuário.
- `409`: `{ "error": "finalizado", "resultUrl": "/api/simulados/:id/result" }`.

---

## PUT `/api/simulados/:id/answers/:questionId`

Salva ou atualiza a resposta. É idempotente e a última escrita vence.

**Corpo**
```json
{ "choiceId": "uuid | null", "text": "string | null", "timeMsDelta": 15000, "flagged": false }
```

**Regras**
- `timeMsDelta` (0–600000) é **somado** ao `time_ms`. O total por tentativa é limitado à duração real no servidor.
- Se `now > deadlineAt`: `409 { "error": "prazo_encerrado" }` e nada é gravado.
- Treino com revelação imediata: depois do `reveal` da questão, `choiceId` e `text` não podem mais mudar (`409 { "error": "resposta_travada" }`), mas `timeMsDelta` e `flagged` são aceitos.
- `text` passa por `inspectText` (guardrail) antes de ser gravado; o texto original não é usado em prompts sem o delimitador.
- `choiceId` precisa pertencer à questão (`400`).

**200**: `{ "ok": true, "timeMs": 57000 }`

---

## POST `/api/simulados/:id/reveal/:questionId`

Só para **treino** com `reveal = "imediato"`. Trava a resposta e devolve o gabarito da questão.

**Corpo**: `{ "selfGrade": { "checked": [true, false, true] } | null }`. É opcional e serve para discursivas corrigidas por checklist no ato.

**Regras**
- Se não havia resposta (sem `choiceId` nem `text`), marca `revealed_before_answer = true` e a questão vale 0 ponto.
- Objetiva: calcula `score` (0 ou 1, `graded_by = auto`).
- Discursiva com `selfGrade`: `score = marcados / total`, `graded_by = checklist`.

**200**
```json
{
  "correctId": "uuid",
  "alternatives": [ { "id": "uuid", "correct": true, "explanation": "…" } ],
  "expectedAnswer": "… | null",
  "keyPoints": ["…"],
  "score": 1,
  "gradedBy": "auto"
}
```

**403** em modo prova.

---

## POST `/api/simulados/:id/finish`

Finaliza a tentativa: corrige as objetivas, zera as em branco, calcula os pontos e grava no ledger. É idempotente.

**200** (`SimuladoScore` de `shared/scoring.ts`)
```json
{ "id": "uuid", "base": 540, "timeBonus": 36, "total": 576, "accuracy": 0.8, "countsForRanking": true, "pendingDiscursive": 2 }
```

**Regras**
- `totalTimeMs = min(finishedAt - startedAt, timeLimitMs)`.
- Discursivas com texto e sem nota ficam `score = null` (pendentes). Elas não pontuam até serem corrigidas.
- `UPDATE attempt … WHERE finished_at IS NULL` e `INSERT points_ledger` no mesmo `db.batch`.

---

## GET `/api/simulados/:id/result`

Resultado completo, disponível só depois de finalizado (`409` antes).

**200**
```json
{
  "id": "uuid",
  "config": { "...": "..." },
  "score": { "base": 540, "timeBonus": 36, "total": 576, "accuracy": 0.8, "countsForRanking": true },
  "totalTimeMs": 1830000,
  "questions": [
    {
      "id": "uuid", "presentAs": "objetiva", "stem": "…", "case": null,
      "alternatives": [ { "id": "uuid", "text": "…", "correct": true, "explanation": "…" } ],
      "expectedAnswer": null, "keyPoints": [],
      "answer": { "choiceId": "uuid", "text": null, "score": 1, "gradedBy": "auto", "timeMs": 42000, "usedHint": false, "revealedBeforeAnswer": false, "flagged": false }
    }
  ],
  "byTopic": [ { "discipline": "Ginecologia", "topic": "Prolapso genital", "n": 6, "accuracy": 0.67 } ]
}
```

---

## POST `/api/simulados/:id/answers/:questionId/grade`

Corrige uma discursiva **depois** de finalizada.

**Corpo**: `{ "method": "checklist", "checked": [true, false, true] }` ou `{ "method": "ia" }`

**Regras**
- Só aceita discursivas com `score = null`. Uma questão já corrigida devolve `409`.
- `ia`: passa por `reserveAiRequest` e chama `gradeDiscursive` (spec 005). Se a IA estiver indisponível, devolve `503` e o cliente sugere o checklist.
- Recalcula `scoreSimulado` e grava em `points_ledger` um lançamento `ajuste:correcao` com a **diferença** em relação ao total anterior.

**200**: `{ "score": 0.75, "gradedBy": "ia", "feedback": "…", "matched": [true, true, false, true], "points": { "total": 598, "delta": 22 } }`
