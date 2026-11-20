# 02 · Requisitos de usuário

Prioridade: **M** = obrigatório no MVP (Fase 1) · **D** = desejável (Fase 2) · **F** = futuro (Fase 3).
Cada requisito aponta para a spec que o detalha. Status do protótipo: ✅ navegável no mock · 🟡 parcial · ⬜ não iniciado.

## RU-01 · Acesso e conta — [spec 001](../specs/001-autenticacao/spec.md)

| ID | Requisito | Prior. | Protótipo |
|---|---|---|---|
| RU-01.1 | Como estudante, quero entrar com minha conta Google para não criar senha. | M | ✅ (simulado) |
| RU-01.2 | Quero que minhas estatísticas, questões e simulados fiquem salvos e apareçam em qualquer dispositivo. | M | 🟡 (localStorage) |
| RU-01.3 | Quero escolher se apareço no ranking público e poder excluir minha conta e meus dados (LGPD). | M | ⬜ |
| RU-01.4 | Quero informar instituição/curso para aparecer no ranking. | D | ⬜ |

## RU-02 · Importar questões (requisito principal) — [spec 002](../specs/002-importacao-questoes/spec.md)

| ID | Requisito | Prior. | Protótipo |
|---|---|---|---|
| RU-02.1 | Quero enviar um **PDF** de questões respondidas e o sistema extrair as questões e respostas automaticamente. | M | ✅ extração real + segmentação real; IA simulada |
| RU-02.2 | Se o PDF tiver imagens/for escaneado, quero que o sistema use um modelo de visão **ou** me oriente a usar meu próprio agente de IA. | M | 🟡 detecção real de páginas com imagem |
| RU-02.3 | Quero copiar um **prompt pronto**, usar no meu agente (ChatGPT, Claude, Gemini…) com o PDF e colar o resultado para importar. | M | ✅ validação real (zod) |
| RU-02.4 | Quero **cadastrar manualmente** pergunta, resposta e alternativas. | M | ✅ |
| RU-02.5 | Quero informar alternativas incorretas **ou pedir para a IA gerá-las**. | M | ✅ (IA simulada) |
| RU-02.6 | Após o processamento, quero ver **cards** por Área e Disciplina (e Assunto) com as questões de cada um. | M | ✅ |
| RU-02.7 | Quero **editar** cards (área, disciplina, assunto, descrição), **mover** questões entre cards e **criar** novos cards. | M | ✅ arrastar-e-soltar + "Mover para" |
| RU-02.8 | Quero que a IA **resuma e categorize** as questões (área, disciplina, assunto). | M | 🟡 (heurística no mock) |
| RU-02.9 | Só quando eu **confirmar**, as questões são gravadas no banco vinculadas a mim. | M | ✅ |
| RU-02.10 | Quero escolher se as questões importadas ficam privadas ou públicas (comunidade). | M | ✅ |
| RU-02.11 | O sistema deve **barrar comandos de injeção/hacking** escondidos nas questões. | M | ✅ guardrail determinístico real |
| RU-02.12 | Uma questão tem **um enunciado e uma ou mais perguntas**, cada pergunta com a sua resposta (discursiva e/ou múltipla escolha); ou só o enunciado e a resposta. | M | ✅ (revisão 2026-11-20) |
| RU-02.13 | Para cada pergunta, o sistema identifica os **pontos de acerto** e gera **múltipla escolha** se o usuário quiser; sabe **corrigir as duas** formas. | M | ✅ (IA simulada; gabarito de referência com 488 perguntas) |
| RU-02.14 | A qualidade do importador é **medida** contra a extração de referência dos PDFs reais. | M | ✅ `npm run eval:import` ([docs/10](10-avaliacao-importador.md)) |

## RU-03 · Simulados — [spec 003](../specs/003-simulados/spec.md)

| ID | Requisito | Prior. | Protótipo |
|---|---|---|---|
| RU-03.1 | Quero escolher **Área, Disciplinas** (e Assuntos), **quantidade**, **tempo limite** e o **modo**. | M | ✅ |
| RU-03.2 | Quero usar **só minhas questões** ou incluir **as da comunidade**. | M | ✅ |
| RU-03.3 | **Modo prova:** questões aleatórias, tempo limite, sem ver respostas até terminar; vale **muito mais pontos**. | M | ✅ |
| RU-03.4 | **Modo treino:** posso conferir a resposta a cada questão **ou** só no final, filtrar assuntos específicos e pedir dicas. | M | ✅ |
| RU-03.5 | O sistema mede o **tempo de cada questão** e o **tempo total**. | M | ✅ |
| RU-03.6 | Ao final, quero o **gabarito** com minha resposta, a correta, o tempo e a explicação. | M | ✅ |
| RU-03.7 | Discursivas: quero me autocorrigir por **checklist** ou pedir **correção por IA**. | M/D | ✅ (IA simulada) |
| RU-03.8 | Quero **dicas com IA** dizendo por que uma alternativa é certa e outra errada. | D | ✅ (simulada) |
| RU-03.9 | Quero refazer **só o que errei**. | D | ✅ |
| RU-03.10 | Quero simulado **aleatório** com um clique (sem configurar). | D | 🟡 (área "Todas") |

## RU-04 · Dashboard e ranking — [spec 004](../specs/004-dashboard-ranking/spec.md)

| ID | Requisito | Prior. | Protótipo |
|---|---|---|---|
| RU-04.1 | Quero ver **% de acertos médio**, **simulados feitos**, questões respondidas, tempo médio por questão. | M | ✅ |
| RU-04.2 | Quero uma **nota/pontuação** que me represente e apareça no ranking. | M | ✅ |
| RU-04.3 | Quero um **painel à direita com o ranking** dos estudantes com maior pontuação. | M | ✅ |
| RU-04.4 | Quero ver meu desempenho **por assunto** e qual é meu ponto mais fraco. | M | ✅ |
| RU-04.5 | Quero ver minha **atividade** (heatmap) e **sequência de dias**. | D | ✅ |
| RU-04.6 | Ranking por **semana / mês / geral** e por área. | D | 🟡 (sem filtro de área) |

## RU-05 · Assistente de IA e segurança — [spec 005](../specs/005-ia-assistente-guardrails/spec.md)

| ID | Requisito | Prior. | Protótipo |
|---|---|---|---|
| RU-05.1 | A IA deve funcionar **mesmo quando um modelo gratuito falhar** (fallback), sem eu perceber além de um aviso. | M | ⬜ (implementado no backend base, não integrado) |
| RU-05.2 | Respostas ruins da IA (JSON inválido, inventadas) devem ser **descartadas e refeitas** automaticamente. | M | ⬜ (idem) |
| RU-05.3 | Nenhum texto inserido por usuário pode fazer a IA mudar de comportamento, vazar dados ou dar pontos. | M | 🟡 |
| RU-05.4 | Quando a cota de IA acabar, quero ser avisado e ter alternativas (agente externo, autocorreção). | M | ⬜ |

## Fora do escopo inicial (Fase 3+)

Flashcards, caderno de erros completo, teoria/resumos por assunto, turmas/grupos privados, app mobile nativo, pagamentos, modo offline (PWA), tema escuro, chave OpenRouter própria (BYOK).
