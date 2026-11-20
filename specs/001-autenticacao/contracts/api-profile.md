# Contrato — `/api/profile`, `/api/account` e `/api/ranking`

**Spec**: [001 › US3/US4](../spec.md) · Validação: [`shared/schemas/profile.ts`](../../../shared/schemas/profile.ts) (mesmas regras do formulário) · Implementação: [`server/routes/profile.ts`](../../../server/routes/profile.ts), [`server/services/profile.ts`](../../../server/services/profile.ts), [`server/services/account-deletion.ts`](../../../server/services/account-deletion.ts), [`server/services/ranking.ts`](../../../server/services/ranking.ts) · Cliente: `api.profile`, `api.account`, `api.ranking` em [`src/lib/api.ts`](../../../src/lib/api.ts)

Todas as rotas exigem sessão (`401 { error: "Faça login para continuar." }`, SC-002). Erros: `{ error: string }` em pt-BR.

## Rotas

| Método | Rota | Corpo / query | Resposta |
|---|---|---|---|
| GET | `/api/profile` | — | `200 Profile` (criado sob demanda se faltar) |
| PATCH | `/api/profile` | `ProfilePatch` (parcial, ≥ 1 campo) | `200 Profile` · `400` validação |
| DELETE | `/api/account` | `{ "confirm": "EXCLUIR" }` | `200 { deleted: true, anonymizedQuestions }` + cookies de sessão expirados · `400` sem a confirmação |
| GET | `/api/ranking` | `?periodo=semana\|mes\|geral` | `200 { periodo, rows: { userId, name, image, institution, points, me }[] }` (até 50) |

`GET /api/me` (FR-003) continua devolvendo `{ user, profile }` e nunca 401.

## Tipos

- **`Profile`**: `{ displayName, institution, course, showInRanking, onboardedAt }` (`null` quando vazio; `onboardedAt` ISO).
- **`ProfilePatch`**:
  - `displayName`: 2–40 caracteres;
  - `institution`, `course`: ≤ 80, `""`/`null` apaga;
  - `showInRanking`: boolean;
  - `onboarded`: `true` — aviso único visto: grava `onboarded_at` e `privacy_ack_at` só na primeira vez.

  Textos passam por `normalizeText` (guardrails). Marcação HTML é removida, espaços e quebras são juntados, e o texto é renderizado como texto puro.

## Regras

- **Ranking (FR-008, SC-003):**
  - O nome exibido é `profile.display_name`; se vazio, o nome do Google.
  - Com `show_in_ranking = false`, o usuário some das respostas de **outros** usuários, mas continua vendo a própria linha (`me: true`) e os pontos continuam no `points_ledger`.
- **Exclusão (FR-010, SC-004)** — um único `db.batch` (atômico no neon-http):
  1. Questões do usuário que **outros** já responderam são anonimizadas, porque `attempt_question`/`attempt_answer` apontam para elas sem cascade:
     - o enunciado passa a ser `[Questão removida pelo autor]`;
     - perguntas e alternativas ficam vazias;
     - recebem `deleted_at` e ficam `privada`;
     - o dono e o card passam ao usuário técnico `comunidade`, que não tem `account` e não faz login.

     O histórico do outro estudante mantém só a pontuação.
  2. Depois, `DELETE FROM user` remove em cascata: sessões, contas, perfil, questões, cards, importações, tentativas e pontos. `ai_call.user_id` vira `NULL`.
  3. A resposta expira os cookies de sessão. O mesmo Google pode criar uma conta nova do zero.

## Testes

- `shared/__tests__/profile.test.ts`: limites e sanitização.
- `server/__tests__/ranking.db.test.ts`: SC-003.
- `server/__tests__/account-deletion.db.test.ts`: SC-004.
- `server/__tests__/auth-callback.db.test.ts`: T021. Cobre login → PATCH → DELETE pelas rotas reais.

Os `*.db.test.ts` rodam com `npm run test:db`, usando o Postgres do `.env` ou `TEST_DATABASE_URL`, e ficam fora do `npm run check`.
