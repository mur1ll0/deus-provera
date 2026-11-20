# Tarefas — 001 Autenticação e perfil

**Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

Legenda: `[P]` = paralelizável (arquivos independentes) · `[x]` = concluída

## Fase 1 — Setup

- [x] T001 Instalar `better-auth`, `drizzle-orm`, `@neondatabase/serverless`, `hono`, `drizzle-kit` (`package.json`)
- [x] T002 Validação de variáveis de ambiente de auth (`server/env.ts`) e modelo em `.env.example`
- [x] T003 `drizzle.config.ts` apontando para `server/db/schema.ts` (URL não-pooled para migrações)
- [ ] T004 Criar projeto no Google Cloud, tela de consentimento (escopos `openid email profile`) e credenciais OAuth com callbacks de produção e `http://localhost:3000/api/auth/callback/google`
- [ ] T005 Criar banco Neon pela integração Vercel Marketplace e configurar `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/`GOOGLE_*` por ambiente na Vercel
- [x] T006 [P] Documentar o dev local com API (`npm run dev:api`: Vite + Hono na mesma origem, porta 3000; `dev:full` = `vercel dev` opcional) e o checklist de auth em `README.md`

## Fase 2 — Fundação

- [x] T007 Tabelas `user`, `session`, `account`, `verification`, `profile` (`server/db/schema.ts`)
- [x] T008 Instância do Better Auth com Google, Drizzle, sessão de 30 dias e `cookieCache` (`server/auth.ts`)
- [x] T009 `sessionMiddleware` e `requireUser` (`server/middleware.ts`)
- [x] T010 Montar `/api/auth/*` e `GET /api/me` (`server/app.ts`)
- [x] T011 Conferir paridade do schema com o core do Better Auth 1.7 e ajustar `server/db/schema.ts` se preciso (conferido campo a campo contra a documentação do schema core; sem divergências — CLI não executado)
- [x] T012 Acrescentar `privacy_ack_at` e `onboarded_at` em `profile` (`server/db/schema.ts`) e gerar a migração inicial (`server/db/migrations/0000_init.sql`)
- [x] T013 [P] Cliente HTTP com `credentials: 'same-origin'`, erro padronizado e tratamento global de 401 (`src/lib/api.ts`)
- [x] T014 [P] `createAuthClient()` (`src/lib/auth-client.ts`)
- [x] T015 `AuthProvider` + hook `useAuth()` lendo `GET /api/me` via TanStack Query (`src/app/AuthProvider.tsx`, `src/app/auth-context.ts`)

## Fase 3 — US1 Entrar com Google (P1)

- [x] T016 Substituir o login simulado por `authClient.signIn.social({ provider: 'google', callbackURL })` (`src/features/auth/LoginPage.tsx`)
- [x] T017 Guard de rota `RequireAuth` preservando a rota de origem; remover o check de `loggedIn` do store (`src/app/RequireAuth.tsx`, `src/app/AppLayout.tsx`, `src/app/router.tsx`, `src/features/simulado/SimuladoRunnerPage.tsx`)
- [x] T018 Hook `databaseHooks.user.create.after` para criar `profile` com `display_name` do Google (`server/auth.ts`)
- [x] T019 Mensagem "Login cancelado" quando o Google retorna `error=access_denied` (`src/features/auth/LoginPage.tsx`)
- [ ] T020 [P] Aviso único sobre o ranking no primeiro acesso, que grava `onboarded_at` (`src/features/dashboard/DashboardPage.tsx`, `server/routes/profile.ts`)
- [ ] T021 Teste de integração: callback com Google mockado cria `user`, `account`, `session`, `profile` (`server/__tests__/auth.test.ts`)

## Fase 4 — US2 Sessão persistente e logout (P1)

- [x] T022 Logout real (`authClient.signOut()`) na sidebar e na topbar mobile (`src/app/AppLayout.tsx`)
- [x] T023 Tratamento de 401 sem loop: limpa cache e redireciona uma única vez (`src/lib/api.ts`)
- [ ] T024 Fila local de respostas pendentes do simulado reenviada após novo login (depende da spec 003) (`src/features/simulado/`)
- [x] T025 Teste: todas as rotas registradas sob `requireUser` respondem 401 sem cookie (SC-002) (`server/__tests__/auth-guard.test.ts`)

## Fase 5 — US3 Perfil e privacidade (P2)

- [ ] T026 [P] Schema zod do perfil (`shared/schemas/profile.ts`) + testes (`shared/__tests__/profile.test.ts`)
- [ ] T027 `GET/PATCH /api/profile` com `normalizeText` nos campos de texto (`server/routes/profile.ts`, montar em `server/app.ts`)
- [ ] T028 Página de perfil: nome de exibição, instituição, curso, alternância "Aparecer no ranking" (`src/features/profile/ProfilePage.tsx`, rota `/perfil`)
- [ ] T029 Respeitar `show_in_ranking` no ranking (já há `having bool_and(show_in_ranking)` em `server/routes/ranking.ts`; cobrir com teste SC-003)

## Fase 6 — US4 Excluir conta (P3)

- [ ] T030 Serviço de exclusão: soft-delete de questões públicas + `DELETE FROM user` em `db.batch` (`server/services/account-deletion.ts`)
- [ ] T031 `DELETE /api/account` exigindo `{ confirm: "EXCLUIR" }` (`server/routes/profile.ts`)
- [ ] T032 "Zona de perigo" com confirmação digitada (`src/features/profile/ProfilePage.tsx`)
- [ ] T033 Teste de integração SC-004: nenhuma linha restante com o `user_id` (`server/__tests__/account-deletion.test.ts`)

## Fase 7 — Polimento

- [ ] T034 [P] Acessibilidade da tela de login e perfil: foco visível, `aria-live` para erros, contraste AA
- [ ] T035 [P] Revisão LGPD: texto do aviso de privacidade e link na tela de login
- [ ] T036 Remover `login`/`logout`/`loggedIn` do store do protótipo (`src/mocks/store.tsx`) quando o cliente real estiver ativo

## Definição de pronto

- [ ] Login Google funcionando em produção e em `localhost:3000`
- [ ] `npm run check` verde (typecheck + lint + vitest), incluindo os testes T021, T025, T026, T033
- [ ] SC-001 a SC-005 verificados e registrados no PR
- [ ] Nenhum dado de sessão no `localStorage`/`sessionStorage`
- [ ] `docs/` atualizado se algum contrato mudou
