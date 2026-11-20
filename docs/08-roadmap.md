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

**Marco:** validação do layout e do fluxo com o cliente ⟵ *estamos aqui*.

## Fase 1 — MVP (S1–S3)

### S1 · Infra + autenticação + banco de questões manual — spec [001](../specs/001-autenticacao/spec.md), parte da [002](../specs/002-importacao-questoes/spec.md)
- Projeto Vercel + Neon (Marketplace) + variáveis; repositório GitHub; preview por PR.
- Google OAuth (Cloud Console) + Better Auth; migrações Drizzle; seed de áreas/disciplinas comuns.
- Cliente de API tipado no front (Hono RPC) + TanStack Query; substituir `src/mocks/store.tsx` tela a tela.
- CRUD de questões manual (editor já existe no protótipo).
- **Marco:** login real e questões manuais salvas no Postgres.

### S2 · Importação — spec [002](../specs/002-importacao-questoes/spec.md)
- Agente externo (JSON → revisão → commit) — sem custo de IA, entrega valor primeiro.
- PDF com IA: `POST /imports` + loop `/run` + revisão + `commit`; fallback determinístico.
- OpenRouter: chave, **US$10 de créditos** (1000 req/dia), guardrail da conta em modo flag.
- **Marco:** os dois PDFs de exemplo importados de ponta a ponta.

### S3 · Simulados, pontuação, dashboard e ranking — specs [003](../specs/003-simulados/spec.md), [004](../specs/004-dashboard-ranking/spec.md)
- Sorteio e prazo no servidor, salvamento incremental de respostas e tempo, finalização e gabarito.
- `points_ledger`, ranking por período, estatísticas do dashboard.
- **Marco:** MVP em produção para a turma (beta fechado).

## Fase 2 — IA assistente (S4–S5) — spec [005](../specs/005-ia-assistente-guardrails/spec.md)

- Explicações por alternativa (cache compartilhado), dicas, correção de discursivas por IA.
- Distratores no editor e em lote na revisão.
- Visão: render das páginas com imagem no navegador → descrição na questão.
- Classificador LLM no guardrail; conjunto adversarial de testes.
- `server/ai/eval` + `npm run ai:eval`; painel admin de cota/telemetria.
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
