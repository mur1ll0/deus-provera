# Constituição do projeto Deus Proverá

> Princípios não negociáveis. Toda spec, plano e PR deve declarar conformidade (seção "Verificação da constituição" do `plan.md`).
> Layout compatível com o [GitHub Spec Kit](https://github.com/github/spec-kit): `.specify/memory/constitution.md` + `specs/NNN-feature/{spec,plan,tasks}.md`.

**Versão**: 1.0.0 · **Ratificada**: 2026-11-19 · **Última alteração**: 2026-11-19

---

## I. Spec primeiro

Nenhuma funcionalidade é implementada sem `spec.md` (o quê e por quê), `plan.md` (como) e `tasks.md` (passos verificáveis) em `specs/NNN-*`.
Mudança de comportamento → atualizar a spec **no mesmo PR**. Dúvidas reais ficam marcadas como `[PRECISA ESCLARECER: …]` e bloqueiam a tarefa afetada, não o projeto.

## II. Usuário no controle do conteúdo

- A IA **sugere**, o usuário **decide**: nada importado entra no banco sem a tela de revisão e a confirmação explícita.
- Nenhuma falha (de IA, rede ou cota) pode fazer o usuário perder conteúdo: sempre existe um caminho determinístico que entrega os blocos crus para revisão.
- Conteúdo gerado por IA é sempre identificado (selo "IA") e editável.

## III. IA gratuita, resiliente e econômica

- Somente modelos gratuitos (`:free`) do OpenRouter em produção. Um modelo pago na cadeia de fallback é bug.
- Fallback em 3 camadas: (1) `models` do OpenRouter, (2) reparo + próximo modelo quando a **saída** é ruim, (3) fallback determinístico.
- Toda chamada passa pelo orçamento (diário global e por usuário), pelo circuit breaker e pela telemetria (`ai_call`).
- Pré-processar de forma determinística antes de chamar o LLM (extração no navegador, segmentação por regex, lotes) e **cachear** o que pode ser compartilhado (explicações de questões públicas).

## IV. Segurança por padrão

- Todo conteúdo enviado pelo usuário (PDF, JSON, respostas) é **dado, nunca instrução**: guardrail determinístico + delimitação com nonce + modelos sem ferramentas + schema estrito + validação zod.
- Saída de IA é renderizada como **texto puro** (nunca `dangerouslySetInnerHTML`).
- Regras que valem pontos ficam **no servidor**: sorteio, prazo, gabarito, correção objetiva, pontuação e ranking. O cliente só exibe.
- LGPD: coletar o mínimo (nome, e-mail, foto do Google), opt-out do ranking, exclusão de conta com remoção dos dados, segredos só em variáveis de ambiente.

## V. Regras compartilhadas e testadas

Regras de negócio puras (pontuação, guardrails, contrato de importação, segmentação) vivem em `shared/`, são usadas igualmente pelo cliente e pelo servidor e têm testes (vitest). Mudou a regra → mudou o teste → mudou a doc (`docs/07-pontuacao-e-ranking.md`, contratos).

## VI. Simplicidade serverless

- Uma única função Hono (`api/index.ts`) + SPA estático na Vercel; Postgres (Neon) como única infraestrutura com estado.
- Respeitar os limites do plano Hobby: corpo de requisição ≤ 4,5 MB, função ≤ 300 s (trabalho longo vira passos idempotentes com checkpoint no banco).
- Nova dependência pesada (> 5 MB instalada) ou novo serviço externo exige ADR em `docs/09-decisoes-adr.md`.

## VII. Acessível e mobile-first

- Interface em pt-BR, contraste WCAG AA, fonte legível (Atkinson Hyperlegible), foco visível, operação completa por teclado (atalhos no simulado), alvos de toque ≥ 40 px.
- Toda tela funciona em 375 px de largura sem rolagem horizontal; respeitar `prefers-reduced-motion`.

---

## Governança

- Emendas: PR alterando este arquivo + incremento de versão (MAJOR remove/redefine princípio; MINOR adiciona; PATCH redação) + nota no `docs/09-decisoes-adr.md`.
- Revisão de conformidade em todo PR: checklist do `plan.md` da feature + `npm run check` verde.
