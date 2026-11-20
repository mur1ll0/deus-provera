# Contrato — `/api/questions` e `/api/taxonomy` (banco de questões)

**Spec**: [002 › US5](../spec.md) · Validação: [`shared/schemas/question.ts`](../../../shared/schemas/question.ts) (mesmas regras do editor) · Implementação: [`server/routes/questions.ts`](../../../server/routes/questions.ts), [`server/services/questions.ts`](../../../server/services/questions.ts) · Cliente tipado (Hono RPC): [`src/lib/api.ts`](../../../src/lib/api.ts)

Todas as rotas exigem sessão (`401 { error }` sem cookie — SC-002 da spec 001, coberto por `server/__tests__/auth-guard.test.ts`). Erros seguem `{ error: string }` em pt-BR.

## Modelo

Questão = **enunciado** (`stem`) + **perguntas** (`items[]`, ≥ 1). Cada pergunta: `type` original (`objetiva | discursiva`), `prompt` (vazio na pergunta única), `expectedAnswer`, `keyPoints[]` e `alternatives[]` (opcional; se houver: ≥ 2 e exatamente 1 correta). A resposta é o tipo `Question` de [`shared/domain.ts`](../../../shared/domain.ts).

## Rotas

| Método | Rota | Corpo / query | Resposta |
|---|---|---|---|
| GET | `/api/questions` | `?scope=todas\|minhas\|comunidade&areaId=&disciplineId=&q=&limit=200&offset=0` | `200 { questions: Question[], groups: QuestionGroup[], total }` |
| GET | `/api/questions/:id` | — | `200 Question` · `404` (inexistente, excluída ou privada de outro dono) |
| POST | `/api/questions` | `QuestionInput` | `201 Question` (`origin: manual`) · `400` validação · `409` duplicata |
| PUT | `/api/questions/:id` | `QuestionInput` (substituição completa) | `200 Question` · `404` não é do usuário · `409` duplicata ou pergunta/alternativa já respondida removida |
| DELETE | `/api/questions/:id` | — | `204` (soft-delete: `deleted_at`) · `404` |
| GET | `/api/taxonomy` | — | `200 { areas: {id,name}[], disciplines: {id,areaId,name}[] }` |

- **Escopo**: `minhas` = do usuário (privadas e públicas); `comunidade` = públicas de outros; `todas` = união. Excluídas nunca aparecem.
- **`QuestionInput`**: `areaId` (uuid de uma área existente), `discipline` (nome — criada na área se não existir, por slug), `topic?` (assunto amplo), `sourceLabel?`, `stem`, `items[]`, `difficulty`, `visibility` (padrão `privada`), `hasImage`, `imageDescription?`. Textos passam por `normalizeText` (guardrails) e são exibidos como texto puro.
- **Card**: a questão entra no `question_group` do dono com a mesma Área › Disciplina · Assunto (reaproveitado ou criado).
- **Edição**: ids de perguntas/alternativas enviados só são reaproveitados se já pertencem à questão (os demais viram novos registros). Perguntas/alternativas ausentes são removidas; se já foram respondidas em simulados, a edição falha com `409`.
- **Duplicatas**: `content_hash` = SHA-256 do enunciado + perguntas + alternativas normalizados ([`shared/content-hash.ts`](../../../shared/content-hash.ts)), único por dono entre as não excluídas (índice parcial).
- **Atomicidade**: cada escrita é um único `db.batch` (neon-http, sem transação interativa).
