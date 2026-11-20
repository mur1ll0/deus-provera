# 03 · Requisitos técnicos e não funcionais

## 1. Stack (versões verificadas em 2026-11-19)

| Camada | Tecnologia | Versão | Observação |
|---|---|---|---|
| Runtime | Node.js | **24.x** (fixado em `engines`) | A Vercel usa 26.x por padrão em projetos novos — por isso fixamos |
| Build/dev | Vite (Rolldown) | 8.3 | `@vitejs/plugin-react` 6 (Oxc) |
| UI | React | 19.3 | + React Router 8.5 (modo data, `createBrowserRouter`) |
| Estilo | Tailwind CSS | 4.3 | `@tailwindcss/vite`, tokens em `src/index.css` (`@theme`) |
| Ícones / DnD | lucide-react · @dnd-kit/core | 1.76 · 6.3 | |
| PDF | pdfjs-dist | 6.5 | carregado sob demanda (chunk separado) |
| Validação | zod | 4.6 | contratos em `shared/` |
| API | Hono | 4.13 | uma função Vercel (`api/index.ts`) |
| Banco | Neon Postgres + Drizzle ORM | drizzle 0.45 / kit 0.31 | driver `@neondatabase/serverless` (HTTP) |
| Auth | Better Auth | 1.7 | Google OAuth, adapter Drizzle, cookie httpOnly |
| IA | AI SDK (`ai`) + `@openrouter/ai-sdk-provider` | 7.0 / 3.1 | AI SDK 7 é ESM-only e exige Node ≥ 22 |
| Testes | Vitest | 5.1 | regras de `shared/` |
| Lint / tipos | oxlint · TypeScript | 1.90 · 7.0 | TS 7 (compilador nativo) |

## 2. Limites de plataforma que moldam o design

| Plataforma | Limite | Impacto no design |
|---|---|---|
| **Vercel Hobby** | Corpo de requisição/resposta **4,5 MB** | PDF **não** é enviado: texto extraído no navegador; imagens de página em lotes pequenos |
| | Duração máx. da função **300 s** (Fluid) | Pipeline em passos idempotentes com checkpoint (`import_job.state`); cliente chama `/run` em loop |
| | 1 M invocações, **4 h de CPU ativa**/mês (espera de rede não conta) | Chamadas de LLM são I/O — cabem folgadas |
| | Uso não comercial no Hobby | Se houver monetização, migrar para Pro (verificar termos) |
| **OpenRouter (modelos `:free`)** | **20 req/min**; **50 req/dia** sem créditos, **1000 req/dia** após comprar US$10 uma vez | Comprar os US$10 é praticamente obrigatório; lotes de 8 questões por chamada; cache compartilhado; orçamento por usuário |
| | Lista de modelos gratuitos muda com frequência | Registro de modelos por tarefa em um único arquivo + conjunto de avaliação |
| | Modelos gratuitos podem registrar prompts (política por provedor) | Não enviar dados pessoais; avisar no termo de uso |
| **Neon Free** | 1 GB por projeto, 100 CU-h/mês, escala a zero após 5 min | Primeira requisição após ociosidade pode levar ~1 s; índices enxutos |
| **Google OAuth** | Tela de consentimento em modo "Teste" limita a 100 usuários | Publicar o app (verificação básica: nome, e-mail, perfil — escopos não sensíveis) |

## 3. Requisitos não funcionais

| ID | Categoria | Requisito | Meta |
|---|---|---|---|
| RNF-01 | Desempenho | Carregamento inicial do SPA (4G) | LCP < 2,5 s; JS inicial < 200 KB gzip (hoje: 186 KB) |
| RNF-02 | Desempenho | Resposta da API (exceto IA) | p95 < 400 ms com banco aquecido |
| RNF-03 | Desempenho | Importação de PDF de 85 páginas | Revisão disponível em < 3 min com IA; < 10 s sem IA (fallback) |
| RNF-04 | Disponibilidade | Falha de um modelo de IA | Transparente (fallback); falha de **todos** → fluxo determinístico, sem perda de conteúdo |
| RNF-05 | Escalabilidade | Usuários simultâneos no MVP | 200 ativos/dia dentro dos limites gratuitos |
| RNF-06 | Segurança | Injeção de prompt via conteúdo | Bloqueada em camadas (ver [05](05-pipeline-ia.md#guardrails)); testes automatizados de ataques conhecidos |
| RNF-07 | Segurança | Integridade da pontuação | Calculada só no servidor; prazo do modo prova no servidor; livro-razão append-only |
| RNF-08 | Segurança | Segredos | Só em variáveis de ambiente da Vercel; nunca no bundle do cliente |
| RNF-09 | Privacidade (LGPD) | Dados mínimos, opt-out do ranking, exclusão de conta | Exclusão remove questões privadas e anonimiza contribuições públicas |
| RNF-10 | Acessibilidade | WCAG 2.2 AA, teclado, leitor de tela | Atalhos no simulado; foco visível; `aria-*` nos controles |
| RNF-11 | Responsividade | Mobile-first | 375 px sem rolagem horizontal (verificado no protótipo) |
| RNF-12 | Manutenibilidade | Qualidade | `npm run check` (tipos + lint + testes) verde em todo PR |
| RNF-13 | Observabilidade | IA | `ai_call` por chamada (modelo, latência, erro); painel admin simples na Fase 2 |
| RNF-14 | Custo | Infra | R$ 0/mês recorrente (exceto US$10 únicos de créditos OpenRouter) |

## 4. Segurança e LGPD

- **Autenticação:** sessão por cookie `httpOnly`, `Secure`, `SameSite=Lax`, mesma origem (SPA e API no mesmo domínio Vercel).
- **Autorização:** toda rota de dados exige sessão (`requireUser`); consultas sempre filtradas por `owner_id` ou `visibility = 'publica'`.
- **Validação:** zod em toda entrada; limites de tamanho por campo (`shared/schemas/import.ts → LIMITS`).
- **Cabeçalhos:** `hono/secure-headers` (CSP restritiva a definir na Fase 1 — fontes do Google e o próprio domínio).
- **Rate limit:** orçamento de IA diário (global e por usuário); limite de importações simultâneas por usuário (1 job `processando`).
- **Saída de IA:** apenas texto; nada de HTML/Markdown renderizado como HTML.
- **LGPD:** base legal = execução do serviço solicitado; dados coletados: nome, e-mail, foto (Google), conteúdo enviado, estatísticas. Política de privacidade e termos (Fase 1). PDFs **não** são armazenados.
- **Conteúdo de terceiros:** o usuário declara ter direito de uso do material enviado; questões públicas podem ser denunciadas (Fase 2).

## 5. Ambientes

| Ambiente | Onde | Banco |
|---|---|---|
| Local (protótipo) | `npm run dev` (porta 5173) | localStorage (mock) |
| Local (completo) | `vercel dev` (porta 3000) | branch Neon `dev` |
| Preview | Deploy por PR na Vercel | branch Neon por preview (integração) |
| Produção | `main` → Vercel | branch Neon `main` |

## 6. Convenções de código

- TypeScript estrito; imports com alias `@/` (src) e `@shared/` (shared) no frontend; caminhos relativos no servidor.
- Textos de interface e documentação em pt-BR; identificadores de código em inglês (exceto o contrato JSON de importação, que é em pt-BR por ser editado pelo usuário).
- Commits no estilo Conventional Commits (`feat(importacao): …`), referenciando a tarefa da spec (`T012`).
