# 01 · Análise da plataforma de inspiração

**Fonte:** <https://plataformaginecologia.netlify.app/#home> — analisada em 2026-11-19 navegando por todas as seções (home, banco, simulado, correção, teoria, prática, flashcards, revisão, materiais e aulas).

> Observação: a análise foi feita com o navegador embutido do app (equivalente ao Playwright: navegação, leitura do DOM, execução de scripts e screenshots), porque a extensão Chrome não estava conectada.

## 1. O que é

SPA estática (hospedada na Netlify, sem backend) criada por/para uma turma de Medicina da UESPI estudar **Ginecologia – Unidade 2**. Todo o conteúdo é curado à mão (questões, teoria, flashcards). O progresso fica só no navegador (`localStorage`, chave `gin2u:v1`), sem login.

## 2. Mapa de funcionalidades

| Seção (hash) | O que faz | Ideia aproveitada no Deus Proverá |
|---|---|---|
| `#home` | Hero "Estude como a prova cobra." + CTA para o próximo passo, **revisão-relâmpago** (card que vira), anel de **preparação geral** (%), KPIs (questões corrigidas, acerto médio, flashcards, teorias lidas), **heatmap das últimas 4 semanas**, cards dos temas com % e "Próximo: …", **mapa de desempenho por tema**, "trilha × acerto", atalhos | Dashboard com nota de desempenho em anel, KPIs, heatmap de 28 dias, mapa por assunto, "ponto mais fraco" com CTA de treino focado |
| `#banco` | Banco de 94 questões **discursivas** com enunciado completo; filtros por tema e por origem (provas antigas, casos clínicos, autorais) | Banco de questões com cards por Área › Disciplina › Assunto, filtro minhas/comunidade |
| `#sim` | Simulado: escolhe temas, formato (teórica 12 min/questão ou prática 3 min/slide) e quantidade (3/5/10). "Questões sorteadas, **sem ver respostas**, com tempo" | Modo **prova** (aleatório, tempo limite, gabarito no fim) e tempo automático por tipo de questão |
| `#run` | Execução: contador regressivo (5 questões × 12 min = 60:00), caso clínico + subitens (a, b), textarea "Escreva sua resposta completa, como na prova…", anterior/próxima | Runner com cronômetro total + por questão, subitens do mesmo caso juntos |
| Correção | Para cada subitem: **resposta esperada** + **"Checklist da correção — marque o que você citou"** (pontos-chave). A nota vem do que você marcou | Correção de discursivas por **checklist de pontos-chave** (autocorreção) **e** por IA |
| `#teoria` / `#t/<tema>` | Resumo estruturado por tema, tabelas, "pegadinhas do professor", bloco "Como cai", e no fim atalhos para flashcards/questões/aula | Fase 3: resumo gerado por IA por Assunto (a partir das questões do usuário) |
| `#pratica` | "Prova prática estilo Prof. X": slide com caso/imagem e 2 perguntas curtas, com cronômetro | Questões com imagem (descrição pelo modelo de visão) |
| `#flash` | Flashcards "Sabia / Não sabia"; os errados voltam primeiro; meta 70% por tema | Fase 3: flashcards gerados dos pontos-chave |
| `#erros` | **Caderno de erros**: tudo que errou/acertou parcialmente, por tema, "refaça até virar verde" | "Treinar o que errei" no resultado + opção "Priorizar o que errei" no treino; caderno completo na Fase 3 |
| `#mat`, `#aulas` | Links para Drive/YouTube organizados | Fora do escopo inicial |

## 3. Design

- **Paleta:** fundo `#FAF7F9`, texto `#1E1530`, primária vinho `#8A1F5E`; cards brancos com raio ~12–20 px e sombra suave; cada tema com um gradiente pastel e ícone.
- **Tipografia:** *Sora* (títulos, peso 700–800) + *Atkinson Hyperlegible* (corpo, fonte desenhada para legibilidade — ótima para estudo prolongado).
- **Navegação:** barra superior com ícones; tudo a 1–2 cliques; CTA principal sempre visível.
- **Tom de voz:** direto, de colega de turma ("Estude como a prova cobra.", "seja honesto").

Mantivemos a paleta vinho e as fontes, adicionando o **dourado** (`#F2B632`) como cor de conquista/"provisão" (pontos, ranking, IA).

## 4. Limitações observadas (e como o Deus Proverá resolve)

| Limitação | Solução |
|---|---|
| Conteúdo fixo, curado manualmente para uma disciplina | Usuário **alimenta o próprio banco** (PDF com IA, agente externo ou manual) e pode usar questões da comunidade |
| Só discursivas | Objetivas + discursivas; IA gera **alternativas incorretas** para transformar discursivas em objetivas |
| Progresso só no navegador, sem conta | Login Google, dados no Postgres, estatísticas entre dispositivos |
| Sem gamificação social | **Pontuação + ranking** (semana/mês/geral), prova vale 3× |
| Autocorreção apenas | Autocorreção (vale 50% dos pontos) **ou** correção por IA (100%) |
| Sem explicação das alternativas | "Explicar com IA": por que cada alternativa está certa/errada |
| Tempo só total | Tempo **por questão** e total, "mais demorada", média por questão |

## 5. Insight sobre os PDFs de exemplo

Os dois PDFs enviados (`Unidade II.pdf` — 85 páginas, `III UNIDADE.pdf`) são **documentos Google Docs exportados com camada de texto**: a extração local (pdf.js) recupera ~160 mil caracteres sem IA nenhuma. Estrutura recorrente: `QUESTÃO N.` + caso clínico + subitens `a.`/`b)` + respostas longas escritas pelos alunos. 33 páginas têm imagens (esquemas POP-Q, tabelas) e 9 parecem escaneadas. Daí a estratégia em camadas descrita em [05-pipeline-ia.md](05-pipeline-ia.md): extração local gratuita → segmentação por regex (≈140 itens por PDF) → IA só para estruturar/categorizar em lotes → visão só nas páginas com imagem.
