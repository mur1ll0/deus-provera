# 08 · Roadmap

Sprints de 1 semana (estimativa para 1 dev + agente de IA). Cada sprint fecha com `npm run check` verde, deploy de preview e checklist da spec.

## Fase 0 — Planejamento e protótipo ✅ (concluída em 2026-11-19)

- [x] Análise da plataforma de inspiração ([01](01-analise-inspiracao.md))
- [x] Pesquisa de stack, limites e modelos gratuitos ([03](03-requisitos-tecnicos.md), [05](05-pipeline-ia.md))
- [x] Constituição, requisitos, arquitetura, modelo de dados, pontuação, ADRs
- [x] Specs 001–005 (spec/plan/tasks)
- [x] **Protótipo navegável** (dados fictícios + IA simulada), incluindo extração **real** de PDF no navegador, segmentação **real**, validação **real** do JSON e guardrail **real**
- [x] Regras compartilhadas com testes (`shared/`: pontuação, guardrails, contrato de importação, segmentador)
- [x] Esqueleto do backend (Hono, Drizzle schema, Better Auth, cliente de IA com fallback, grafo de importação, rotas parciais) compilando

**Marco:** validação do layout e do fluxo com o cliente ✅

> **Onde estamos (2026-11-20):** o MVP (S1–S3) está em produção em https://deus-provera.vercel.app, e a Fase 2 está parcialmente feita: explicação, dica, correção por IA, distratores e visão. Antes de abrir o beta para a turma faltam: o bloco de segurança (rate limit, guardrail em todas as entradas, testes de fraude e de injeção), um cliente OAuth próprio (hoje o consentimento mostra "volley-mgm"), publicar o app no consentimento do Google e o aviso de privacidade/LGPD. As tarefas abertas estão nos `tasks.md` de cada spec.

## Fase 1 — MVP (S1–S3) ✅ (2026-11-20)

### S1 · Infra + autenticação + banco de questões manual — spec [001](../specs/001-autenticacao/spec.md), parte da [002](../specs/002-importacao-questoes/spec.md)
- [x] Projeto Vercel + Neon (Marketplace) + variáveis; repositório GitHub. Preview por PR: conferir na Vercel.
- [x] Google OAuth (Cloud Console) + Better Auth; migrações Drizzle; seed de áreas/disciplinas comuns.
- [x] Cliente de API tipado no front (Hono RPC) + TanStack Query; `src/mocks/store.tsx` só no modo protótipo.
- [x] CRUD de questões manual.
- [x] Perfil, exclusão de conta e aviso do ranking (spec 001 US3/US4).
- **Marco:** login real e questões manuais salvas no Postgres ✅

### S2 · Importação — spec [002](../specs/002-importacao-questoes/spec.md)
- [x] Agente externo (JSON → revisão → commit) — sem custo de IA, entrega valor primeiro.
- [x] PDF com IA: `POST /imports` + loop `/run` + revisão + `commit`; fallback determinístico; autosave da revisão.
- [x] OpenRouter: chave, **US$10 de créditos** (1000 req/dia), guardrail da conta em modo flag.
- **Marco:** os dois PDFs de exemplo importados de ponta a ponta ✅ (docs/10 §8)

### S3 · Simulados, pontuação, dashboard e ranking — specs [003](../specs/003-simulados/spec.md), [004](../specs/004-dashboard-ranking/spec.md)
- [x] Sorteio e prazo no servidor, salvamento incremental de respostas e tempo, finalização idempotente e gabarito.
- [x] `points_ledger`, ranking por período e por área, estatísticas do dashboard, abandono > 24 h (cron).
- [x] E2E Playwright e seed grande com medição (ranking p95 < 150 ms).
- **Marco:** MVP em produção ✅; beta fechado para a turma ⟵ *próximo passo* (ver "Onde estamos").

## Fase 2 — IA assistente (S4–S5) — spec [005](../specs/005-ia-assistente-guardrails/spec.md)

- [x] Explicações (cache compartilhado), dicas, correção de discursivas por IA — no simulado real.
- [x] Distratores no editor e em lote na revisão.
- [x] Visão: recorte das imagens no navegador → transcrição na questão (docs/10 §7–§8).
- [ ] Classificador LLM no guardrail; conjunto adversarial de testes.
- [ ] `server/ai/eval` + `npm run ai:eval`; painel admin de cota/telemetria.
- [ ] Ritmo de 20 req/min e testes do cliente de IA com provedor mockado.
- **Marco:** custo de IA por usuário ativo medido e estável dentro de 1000 req/dia.

## Fase 3 — Engajamento (S6+)

- Caderno de erros e "refazer até virar verde"; flashcards gerados dos pontos-chave (inspirados na plataforma de referência).
- Metas semanais, sequência, conquistas.
- Turmas/grupos privados (compartilhar coleções com a turma), denúncia de questões públicas.
- PWA (offline para simulados baixados), tema escuro, BYOK (chave OpenRouter própria → modelos melhores/OCR pago).

## Riscos do projeto

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Modelos gratuitos saem do ar / mudam | Alta | Médio | Registro único de modelos, cadeia de fallback, eval mensal, fallback determinístico |
| Cota de 1000 req/dia insuficiente com crescimento | Média | Alto | Cache compartilhado, lotes, limite por usuário, agente externo, BYOK, plano pago de IA se monetizar |
| Qualidade da extração em PDFs escaneados | Média | Médio | Visão em páginas específicas + recomendação do agente externo + revisão obrigatória |
| Direitos autorais de material enviado | Média | Médio | Termos de uso, questões privadas por padrão (a decidir), denúncia |
| Limite de uso não comercial do Vercel Hobby | Baixa | Médio | Migrar para Pro se houver monetização |
| Google OAuth em modo teste (100 usuários) | Alta | Baixo | Publicar app no consentimento (escopos não sensíveis) antes do beta |
