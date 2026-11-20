# 00 · Visão geral

## Propósito

**Deus Proverá** é um auxiliar de estudos para estudantes de Medicina e de outros cursos. O estudante transforma as próprias listas de questões respondidas (PDFs) em um **banco de questões** e treina com **simulados configuráveis**. O sistema mede o tempo por questão e por simulado, corrige, explica com IA e transforma o esforço em **pontos e ranking**.

> "Estude como a prova cobra. O resto, Deus proverá."

## Personas

| Persona | Contexto | O que precisa |
|---|---|---|
| **Ana, 6º período de Medicina** | Tem PDFs de provas antigas e casos clínicos resolvidos pela turma | Transformar os PDFs em simulados sem digitar tudo; treinar no celular entre plantões |
| **Rafael, monitor da disciplina** | Organiza o material da turma | Cadastrar questões boas, compartilhar com a comunidade, ver quem está estudando |
| **Júlia, outro curso (Enfermagem/Direito/Exatas)** | Usa a plataforma para outras áreas | Taxonomia livre (Área › Disciplina › Assunto), simulados objetivos |

## Escopo do produto (visão completa)

1. **Login com Google** e perfil mínimo.
2. **Importação de questões** (requisito principal): PDF com IA, prompt para agente externo, cadastro manual; revisão em **cards** por Área › Disciplina · Assunto antes de salvar.
3. **Banco de questões**: minhas + comunidade (públicas).
4. **Simulados**: modo **prova** (aleatório, tempo limite, gabarito no fim, ×3 pontos) e modo **treino** (filtros finos, revelar a cada questão, dicas de IA).
5. **Resultado/gabarito** com tempo por questão, correção de discursivas (checklist ou IA), explicações.
6. **Dashboard** com estatísticas e **ranking** no painel direito.
7. **IA assistente** (OpenRouter, modelos gratuitos) com fallback e **guardrails** contra injeção.

## Glossário

| Termo | Definição |
|---|---|
| **Área** | Grande área do conhecimento (ex.: Medicina, Matemática). É o "Tema" citado nos requisitos — renomeado para evitar confusão com "assunto". |
| **Disciplina** | Matéria dentro da área (ex.: Ginecologia, Cálculo). |
| **Assunto** | Tópico específico (ex.: Prolapso genital, Integrais). Permite treinos focados. |
| **Card** | Agrupamento revisável de questões: Área › Disciplina · Assunto + descrição (tabela `question_group`). |
| **Caso** | Texto-base/caso clínico compartilhado por subitens (a, b, c…) — tabela `question_case`. |
| **Objetiva / Discursiva** | Com alternativas / com resposta aberta + pontos-chave. |
| **Distrator** | Alternativa incorreta plausível (pode ser gerada por IA). |
| **Pontos-chave** | Itens que uma boa resposta discursiva deve conter; base do checklist e da correção por IA. |
| **Modo prova / treino** | Ver [07-pontuacao-e-ranking.md](07-pontuacao-e-ranking.md). |
| **Nota de desempenho** | 0–10: acurácia ponderada dos últimos 30 dias (prova pesa 2). |
| **Pontuação (XP)** | Soma de pontos do livro-razão; ordena o ranking. |

## Mapa da documentação

| Documento | Conteúdo |
|---|---|
| [01-analise-inspiracao.md](01-analise-inspiracao.md) | O que a plataforma de referência faz e o que aproveitamos |
| [02-requisitos-usuario.md](02-requisitos-usuario.md) | Requisitos de usuário (RU) com critérios de aceite e rastreabilidade |
| [03-requisitos-tecnicos.md](03-requisitos-tecnicos.md) | Requisitos não funcionais, stack, limites de plataforma, segurança/LGPD |
| [04-arquitetura.md](04-arquitetura.md) | Arquitetura, fluxos, API, estrutura de pastas |
| [05-pipeline-ia.md](05-pipeline-ia.md) | Modelos, fallback, grafo de decisão, guardrails, cota, estratégia para PDFs |
| [06-modelo-de-dados.md](06-modelo-de-dados.md) | ERD, tabelas, Postgres × Mongo |
| [07-pontuacao-e-ranking.md](07-pontuacao-e-ranking.md) | Regras de pontuação, nota, ranking e anti-fraude |
| [08-roadmap.md](08-roadmap.md) | Fases, sprints e marcos |
| [09-decisoes-adr.md](09-decisoes-adr.md) | Registro de decisões de arquitetura |
| [10-avaliacao-importador.md](10-avaliacao-importador.md) | Gabarito de referência dos PDFs reais e métricas do importador |
| [11-provedores-ia.md](11-provedores-ia.md) | Limites reais dos planos grátis, alternativas e "conecte seu modelo" (BYOK) |
| [prompts/prompt-agente-externo.md](prompts/prompt-agente-externo.md) | Prompt que o usuário copia para o agente de IA dele |
| [`../specs/`](../specs) | Specs por feature (spec/plan/tasks), formato Spec Kit |
| [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md) | Princípios do projeto |

## Decisões principais (resumo)

| Tema | Decisão | Por quê (detalhes no ADR) |
|---|---|---|
| Frontend | Vite 8 + React 19 + React Router 8 + Tailwind 4 | SPA atrás de login, sem necessidade de SSR/SEO |
| Backend | Hono em **uma** função Vercel (`api/index.ts`) | Zero-config na Vercel, leve, mesma origem do SPA (cookies sem CORS) |
| Banco | **Postgres (Neon)** + Drizzle | Dados relacionais + agregações do ranking; JSONB onde precisa de flexibilidade |
| Auth | **Better Auth** + Google | Mantido, sem Next.js, adapter Drizzle; Auth.js está em modo manutenção e Lucia foi descontinuado |
| IA | AI SDK 7 + `@openrouter/ai-sdk-provider`, **só modelos `:free`**, cadeia por tarefa | Custo zero com resiliência; troca de modelo é configuração |
| Orquestração | **Grafo de estados próprio** (estilo LangGraph) com checkpoint no Postgres | Mesmo poder de decisão/retomada sem ~98 MB de dependência |
| PDF | Extração **no navegador** (pdf.js) + segmentação determinística + IA em lotes | Grátis, sem upload (limite de 4,5 MB), economiza cota |
| Spec-driven | Layout **Spec Kit** gerenciado manualmente (sem o CLI Python) | Compatível com o `specify` se quiserem instalar depois |
