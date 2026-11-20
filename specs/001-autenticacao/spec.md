# Spec 001 — Autenticação e perfil

**Feature**: 001-autenticacao · **Status**: Pronta para implementação · **Fase**: Fase 1 MVP (Sprint S1)

## Contexto

O Deus Proverá guarda dados pessoais de estudo: questões importadas, simulados, estatísticas e posição no ranking. Para isso o estudante precisa de uma identidade estável entre dispositivos, sem precisar criar mais uma senha. O requisito do usuário é **login com Google (OAuth)**. Ele gerencia a sessão e carrega as estatísticas e os dados salvos.

A aplicação é uma SPA (Vite + React) servida pela Vercel na mesma origem da API (`/api/*`, função Hono única). A autenticação usa **Better Auth** com o provedor Google e o adaptador Drizzle/Postgres (Neon). A sessão fica em cookie httpOnly na mesma origem, então não há CORS nem token no `localStorage`.

Como o ranking é público entre estudantes, o perfil precisa de um mínimo de dados de exibição e de uma opção explícita de **não aparecer no ranking** (LGPD). O estudante também pode **excluir a conta e todos os dados**.

Referências: [docs/02-requisitos-usuario.md](../../docs/02-requisitos-usuario.md), [docs/03-requisitos-tecnicos.md](../../docs/03-requisitos-tecnicos.md), [docs/04-arquitetura.md](../../docs/04-arquitetura.md), [docs/06-modelo-de-dados.md](../../docs/06-modelo-de-dados.md), [docs/09-decisoes-adr.md](../../docs/09-decisoes-adr.md).

## Histórias de usuário

### US1 — Entrar com Google (P1)

Como estudante, quero entrar com minha conta Google para acessar meu painel sem criar senha.

**Por que esta prioridade**: nenhuma outra funcionalidade persistente funciona sem identidade. Questões, simulados e ranking dependem de `user.id`.

**Teste independente**: com o banco vazio, clicar em "Entrar com Google", autorizar e cair no painel (`/`). Em seguida `GET /api/me` retorna o usuário, e as tabelas `user`, `account`, `session` e `profile` têm uma linha cada.

**Cenários de aceite**
1. **Dado** um visitante sem sessão, **quando** acessa qualquer rota protegida (ex.: `/simulados`), **então** é redirecionado para `/login`, e a rota original é preservada para o retorno.
2. **Dado** o visitante em `/login`, **quando** clica em "Entrar com Google" e autoriza, **então** volta para a rota original (ou `/`) já autenticado.
3. **Dado** um primeiro login, **quando** a conta é criada, **então** um `profile` é criado com `display_name` = nome do Google e `show_in_ranking = true`, e o estudante vê um aviso único explicando o ranking e onde desativar.
4. **Dado** o visitante que nega a autorização no Google, **quando** volta ao app, **então** permanece em `/login` com a mensagem "Login cancelado. Tente novamente." e nenhum registro é criado.
5. **Dado** um usuário já cadastrado, **quando** faz login em outro dispositivo, **então** vê as mesmas questões, simulados e estatísticas.

### US2 — Sessão persistente e logout (P1)

Como estudante, quero continuar logado entre visitas e poder sair quando quiser, por exemplo em computador compartilhado da faculdade.

**Por que esta prioridade**: sem persistência o estudante faria login a cada visita. Sem logout há risco em máquinas compartilhadas.

**Teste independente**: logar, fechar o navegador, reabrir no dia seguinte e continuar logado. Clicar em "Sair": o cookie é removido e `GET /api/me` retorna `{ user: null }`.

**Cenários de aceite**
1. **Dado** um usuário logado, **quando** reabre o app em até 30 dias, **então** continua autenticado, e a sessão é renovada no máximo 1x/dia.
2. **Dado** um usuário logado, **quando** clica em "Sair" (sidebar ou topbar mobile), **então** a sessão é invalidada no servidor e ele vai para `/login`.
3. **Dado** uma sessão expirada ou revogada, **quando** o SPA chama a API, **então** recebe 401, e o cliente limpa o estado e redireciona para `/login` sem loop.
4. **Dado** um simulado em andamento, **quando** a sessão expira, **então** o próximo envio de resposta retorna 401. O cliente guarda localmente as respostas pendentes e as reenvia após o novo login. O prazo continua valendo no servidor.

### US3 — Perfil e privacidade no ranking (P2)

Como estudante, quero definir como apareço (nome de exibição, instituição/curso) e escolher se apareço no ranking.

**Por que esta prioridade**: o ranking é um requisito central, mas exibir nome real de terceiros exige controle do titular (LGPD). Não bloqueia o MVP de estudo individual.

**Teste independente**: alterar `display_name`, `institution` e `course` e ver a mudança no painel de ranking. Desmarcar "Aparecer no ranking": o usuário some do `GET /api/ranking` de outros usuários, mas continua vendo a própria pontuação.

**Cenários de aceite**
1. **Dado** o usuário em "Perfil", **quando** salva nome de exibição (2–40 caracteres), instituição e curso (até 80 cada), **então** o ranking e a sidebar passam a mostrar os novos valores.
2. **Dado** o usuário com "Aparecer no ranking" desativado, **quando** outro estudante abre o ranking, **então** ele não aparece. Os pontos continuam acumulando no `points_ledger`.
3. **Dado** um nome de exibição com conteúdo ofensivo ou de injeção (ex.: `<script>`), **quando** salva, **então** o texto é sanitizado e renderizado como texto puro.

### US4 — Excluir conta e dados (P3)

Como estudante, quero excluir minha conta e todos os meus dados.

**Por que esta prioridade**: obrigação legal (LGPD, art. 18). É raro na prática e pode vir depois do fluxo principal, mas deve existir antes de abrir para o público.

**Teste independente**: com um usuário que tem questões, simulados e pontos, acionar "Excluir conta", confirmar digitando "EXCLUIR" e verificar que `user`, `profile`, `session`, `account`, `question*`, `attempt*`, `points_ledger`, `import_job` e `ai_call` do usuário foram apagados ou anonimizados.

**Cenários de aceite**
1. **Dado** o usuário em "Perfil › Zona de perigo", **quando** confirma a exclusão, **então** todos os dados pessoais são removidos (cascata) e ele é deslogado.
2. **Dado** questões **públicas** do usuário usadas em simulados de outros, **quando** a conta é excluída, **então** essas questões também são removidas (soft-delete). Respostas históricas de terceiros mantêm só o registro da pontuação já obtida, sem conteúdo.
3. **Dado** um pedido de exclusão, **quando** concluído, **então** o usuário pode criar nova conta com o mesmo Google, começando do zero.

## Casos de borda

- Conta Google sem foto: avatar com iniciais (componente `Avatar` já existe no protótipo).
- Mesmo e-mail em dois provedores no futuro: hoje só Google; o vínculo de contas fica fora de escopo.
- E-mail Google alterado: a identidade é o `account.account_id` (sub do Google), não o e-mail. O e-mail é atualizado no próximo login.
- Cookies de terceiros bloqueados: não afeta, pois SPA e API estão na mesma origem.
- Preview deployments da Vercel com domínio diferente: callback OAuth configurado só para produção e localhost. Previews usam login simulado só se `NODE_ENV !== 'production'` [PRECISA ESCLARECER: queremos login real nos previews?].
- Usuário menor de idade: o público-alvo é universitário. Não há fluxo específico.
- Múltiplas abas: logout em uma aba invalida as outras na próxima chamada (401 → `/login`).
- `BETTER_AUTH_SECRET` trocado: todas as sessões são invalidadas (comportamento aceito e documentado).

## Requisitos funcionais

- **FR-001**: O sistema DEVE oferecer login exclusivamente via Google OAuth 2.0 (escopos `openid email profile`) usando Better Auth montado em `/api/auth/*`.
- **FR-002**: O sistema DEVE manter a sessão em cookie httpOnly, `Secure` (em produção), `SameSite=Lax`, válido por 30 dias e renovado no máximo 1x/24 h.
- **FR-003**: O sistema DEVE expor `GET /api/me`, que retorna `{ user: { id, name, email, image } | null, profile }` sem nunca retornar 401. É usado pelo SPA para decidir o redirecionamento.
- **FR-004**: Toda rota de API que lê ou escreve dados do usuário DEVE exigir sessão válida (`requireUser`) e responder 401 com `{ error }` quando ausente.
- **FR-005**: O SPA DEVE proteger todas as rotas exceto `/login`, redirecionando para `/login?redirect=<rota>` e voltando à rota original após o login.
- **FR-006**: O sistema DEVE criar `profile` no primeiro login com `display_name` do Google e `show_in_ranking = true`, e exibir aviso único sobre o ranking.
- **FR-007**: O usuário DEVE poder editar `display_name` (2–40), `institution` (≤ 80) e `course` (≤ 80). Os textos passam por `normalizeText` (guardrails) e são renderizados como texto puro.
- **FR-008**: O usuário DEVE poder ativar e desativar `show_in_ranking`. Quando desativado, o ranking de terceiros NÃO DEVE listá-lo.
- **FR-009**: O sistema DEVE oferecer logout que invalida a sessão no servidor (`POST /api/auth/sign-out`) e limpa o estado do cliente.
- **FR-010**: O sistema DEVE oferecer exclusão de conta com confirmação explícita, removendo os dados do usuário por cascata (FKs `onDelete: cascade`) e com soft-delete de questões públicas.
- **FR-011**: O cliente DEVE tratar 401 globalmente: limpar o cache de dados do usuário e redirecionar uma única vez (sem loop).
- **FR-012**: O sistema NÃO DEVE armazenar tokens do Google além do exigido pelo Better Auth, nem solicitar escopos adicionais (Drive, Gmail etc.).
- **FR-013**: O sistema DEVE registrar o consentimento ao aviso de privacidade (data/hora) no `profile` [PRECISA ESCLARECER: precisamos de termos de uso formais antes do lançamento público?].

## Entidades-chave

- **user**: identidade (Better Auth core): `id`, `name`, `email`, `image`.
- **account**: vínculo com o Google (`provider_id = 'google'`, `account_id` = sub).
- **session**: sessão ativa (token, expiração, IP, user agent).
- **verification**: uso interno do Better Auth (state/PKCE do OAuth).
- **profile**: dados de exibição e privacidade (`display_name`, `institution`, `course`, `show_in_ranking`, futuramente `openrouter_key_enc` para BYOK na Fase 3).

Definições em `server/db/schema.ts` e [docs/06-modelo-de-dados.md](../../docs/06-modelo-de-dados.md).

## Critérios de sucesso

- **SC-001**: Um novo usuário vai de `/login` ao painel em ≤ 3 cliques e ≤ 10 s (p95, excluindo o tempo gasto na tela do Google).
- **SC-002**: 100% das rotas de API de dados retornam 401 sem sessão (teste automatizado percorrendo as rotas registradas).
- **SC-003**: Usuário com `show_in_ranking = false` aparece em 0 respostas de `GET /api/ranking` de outros usuários (teste de integração).
- **SC-004**: A exclusão de conta não deixa nenhuma linha com o `user_id` excluído nas tabelas listadas na US4 (teste de integração).
- **SC-005**: Nenhum token de sessão ou dado do Google é gravado em `localStorage`/`sessionStorage` (verificação manual + lint de código).

## Fora de escopo

- Login por e-mail/senha, magic link, Apple, Microsoft ou GitHub.
- Vínculo de várias contas ao mesmo usuário.
- Papéis/perfis administrativos (moderação de questões públicas fica para a Fase 3, junto com "turmas").
- 2FA (delegado ao Google).
- BYOK (chave OpenRouter própria): Fase 3, campo já previsto no schema.

## Pontos em aberto

- [PRECISA ESCLARECER: os deploys de preview da Vercel devem ter login Google real (exige registrar cada URL de callback) ou um login de desenvolvimento?]
- [PRECISA ESCLARECER: é necessário publicar Termos de Uso e Política de Privacidade formais antes da abertura para outras turmas?]
- [PRECISA ESCLARECER: o ranking deve mostrar o nome completo do Google por padrão ou só o primeiro nome + inicial (como no protótipo: "Ana Beatriz L.")?]
