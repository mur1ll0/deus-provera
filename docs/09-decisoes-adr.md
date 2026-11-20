# 09 · Registro de decisões de arquitetura (ADR)

Formato curto: contexto → decisão → alternativas → consequências. Novas decisões entram no fim com número sequencial.

---

## ADR-0001 · SPA Vite + API Hono em uma função Vercel

**Contexto.** Requisitos: React + Tailwind, Node 24, Vercel gratuito, backend à escolha. App inteiro atrás de login (sem SEO).
**Decisão.** Vite 8 + React 19 + React Router 8 (SPA) e **Hono** servido por **uma** função (`api/index.ts`, `vercel.json` reescreve `/api/*`). Código das rotas em `server/` (fora de `api/`, senão cada arquivo vira uma função).
**Alternativas.** Next.js (válido, mas SSR/RSC desnecessários e mais acoplamento); Express (vira uma função monolítica, `express.static` ignorado, tratamento de erros pior na Vercel); Vercel Services (beta).
**Consequências.** Mesma origem para SPA e API (cookies sem CORS); cold start único; RPC tipado via `hc<AppType>`. Limite de 300 s exige pipeline em passos (ADR-0004).

## ADR-0002 · Postgres (Neon) + Drizzle

**Contexto.** Banco gratuito do Marketplace da Vercel; dados relacionais; ranking com agregações.
**Decisão.** **Neon Postgres** (1 GB/projeto, branches por preview) com **Drizzle ORM** e driver HTTP `@neondatabase/serverless`.
**Alternativas.** MongoDB Atlas M0 (0,5 GB, 100 ops/s, sem FKs); Supabase (2 projetos, pausa após 1 semana inativo); Prisma (mais pesado em serverless).
**Consequências.** Transações via `db.batch()` no driver HTTP; JSONB para checkpoint/config; migrações versionadas.

## ADR-0003 · Better Auth com Google

**Contexto.** Login Google, sessão, sem Next.js.
**Decisão.** **Better Auth 1.7** (`socialProviders.google`, `drizzleAdapter`, handler montado em `/api/auth/*` no Hono).
**Alternativas.** Auth.js (`@auth/core`) — desde set/2025 mantido pela equipe do Better Auth apenas com correções de segurança; Lucia — descontinuado (2025); Supabase Auth — amarra a um projeto Supabase que pausa.
**Consequências.** Tabelas `user/session/account/verification` no nosso schema; cookie httpOnly no mesmo domínio.

## ADR-0004 · Orquestração de IA: grafo próprio em vez de LangGraph

**Contexto.** O usuário sugeriu LangGraph para desenhar o fluxo de decisão (retry, fallback, validação). O fluxo precisa de laços (lotes), desvios condicionais, retomada após timeout e checkpoint.
**Decisão.** **Mini state-graph próprio** (`server/ai/graph.ts`) com a semântica do LangGraph (nós, arestas condicionais, retries, checkpoint serializável, `runUntil(deadline)`), checkpoint em `import_job.state`; chamadas de modelo via **AI SDK 7** + provider OpenRouter.
**Alternativas.** LangGraph.js 1.7 + `@langchain/langgraph-checkpoint-postgres` — maduro, mas ~98 MB instalados (vs ~25 MB) e sem uso de agentes/ferramentas; máquina de estados ad hoc sem grafo (menos legível).
**Consequências.** Fluxo explícito e testável; dependências leves. Se no futuro houver agentes com ferramentas (ex.: tutor conversacional), migrar os mesmos nós para LangGraph.

## ADR-0005 · Extração de PDF no navegador + agente externo

**Contexto.** PDFs de 4–8 MB (limite de corpo da Vercel: 4,5 MB); IA só gratuita; requisito principal do produto.
**Decisão.** Extrair texto com **pdf.js no navegador**; segmentar por regex; enviar só texto (em lotes) ao pipeline; páginas com imagem → render JPEG → modelo de visão gratuito. Oferecer o **prompt para agente externo** como caminho alternativo de primeira classe.
**Alternativas.** `file-parser` do OpenRouter (`cloudflare-ai` grátis mas perde imagens e estoura o limite de corpo; `mistral-ocr` pago); Vercel Blob + processamento no servidor (2k operações/mês no Hobby, CPU no servidor).
**Consequências.** Custo zero, privacidade (PDF não sai do navegador), revisão obrigatória para corrigir extrações imperfeitas.

## ADR-0006 · Spec-driven development com layout Spec Kit, sem o CLI

**Contexto.** Pedido de gestão por spec-driven development (Spec Kit ou arquivos próprios).
**Decisão.** Adotar a **estrutura** do GitHub Spec Kit (`.specify/memory/constitution.md`, `specs/NNN-*/{spec,plan,tasks}.md`, `contracts/`) mantida manualmente + `CLAUDE.md` como memória do projeto para agentes. O CLI `specify` (Python/uv) é opcional.
**Consequências.** Compatível com os comandos do Spec Kit se instalados depois (`/specify`, `/plan`, `/tasks`); nenhuma dependência extra agora.

## ADR-0007 · Taxonomia Área › Disciplina › Assunto

**Contexto.** Requisito fala em "Tema (ou matéria)" e "Disciplina".
**Decisão.** **Área** (ex.: Medicina) › **Disciplina** (ex.: Ginecologia) › **Assunto** (ex.: Prolapso genital). Área/Disciplina globais; Assunto livre por card.
**Alternativas.** "Tema/Matéria" — "matéria" é sinônimo de disciplina no Brasil e "tema" confunde com assunto.
**Consequências.** Simulados podem misturar questões da comunidade pela taxonomia global; treinos focados por assunto.

## ADR-0008 · Somente modelos gratuitos, com compra única de créditos

**Contexto.** Orçamento zero; OpenRouter limita `:free` a 50 req/dia sem créditos.
**Decisão.** Usar só modelos `:free`; recomendar **compra única de US$10** para liberar 1000 req/dia; orçamento global e por usuário; cache compartilhado.
**Consequências.** Qualidade variável dos modelos → camadas de validação; plano B sempre disponível (agente externo, autocorreção). BYOK planejado para a Fase 3.

## ADR-0009 · Questão = Enunciado + Perguntas (revisão de 2026-11-20)

**Contexto.** Validação com os PDFs reais: as provas trazem um enunciado (caso clínico) com várias perguntas (a, b, c…), cada uma com a sua resposta; o modelo inicial tratava cada subitem como uma questão com "caso clínico opcional", o que confundia o usuário ("o caso clínico é na verdade o enunciado").
**Decisão.** `Question.stem` (enunciado) + `Question.items[]` (`QuestionItem`: rótulo, texto, tipo original, resposta esperada, pontos de acerto, alternativas). Contrato de importação **v2** (`perguntas[]`). Correção e pontuação **por pergunta**; tempo **por questão**. Simulado escolhe o **formato de resposta** (`original | multipla | discursiva`); uma pergunta discursiva com alternativas geradas por IA pode ser respondida como múltipla escolha.
**Consequências.** Banco com `question_item`, `attempt_answer` por item e `attempt_question` (tempo/marcação). O v1 deixa de ser aceito (mensagem orienta a copiar o prompt novo). Qualidade do importador passa a ser medida contra um gabarito de referência (docs/10).

## ADR-0010 · Estratégia de provedores: pool grátis + "conecte seu modelo" (BYOK)

**Contexto.** OpenRouter grátis = 50 req/dia por conta (1000 após US$10 únicos) — 1–2 PDFs/dia para o app inteiro. O login Google **não** dá acesso à cota/assinatura Gemini do aluno (cobrança por projeto Cloud; uso de assinaturas por terceiros já gerou banimentos).
**Decisão.** (1) Pool do servidor multi-provedor gratuito via AI SDK (`createProviderRegistry`): Gemini Flash-Lite, OpenRouter `:free`, Groq, Cloudflare Workers AI — por tarefa; (2) **"Conectar OpenRouter" via OAuth PKCE** para cada aluno usar a própria cota; (3) agente externo sempre disponível; (4) chave Gemini colada pelo aluno só como opção avançada (termos em zona cinzenta).
**Consequências.** Custo zero para o desenvolvedor com capacidade escalando por aluno. Requer armazenamento cifrado da chave do usuário (`profile.openrouter_key_enc`), avisos de privacidade/termos (18+ no Gemini grátis) e revalidação periódica dos limites (docs/11).
