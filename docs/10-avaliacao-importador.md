# 10 · Avaliação do importador (gabarito de referência)

**Objetivo:** medir, com números, se o importador de PDF separa corretamente **Questão = Enunciado + Perguntas** e anexa cada resposta à pergunta certa, usando os dois PDFs reais (`Unidade II.pdf`, `III UNIDADE.pdf`).

## 1. Gabarito de referência (como foi feito)

1. Cada página dos PDFs foi convertida em **texto** (pdf.js) e, quando tinha imagem, em **PNG** (pdf.js + canvas), em `scripts`/scratchpad.
2. Nove agentes de IA (em paralelo, ~30–55 mil caracteres cada) **leram o texto e as imagens** de cada página e transcreveram as questões seguindo [`samples/private/extracao/INSTRUCOES.md`](../samples/private/extracao/INSTRUCOES.md):
   - transcrição literal de enunciado, perguntas e respostas;
   - dados que só existem em foto/esquema (ex.: quadros POP-Q, enunciados fotografados, prints de WhatsApp) transcritos numa linha `[Imagem p. N: …]`;
   - **pontos de acerto** (3–6 por pergunta) derivados da resposta;
   - **5 alternativas** por pergunta (1 correta + 4 distratores com "por que está errada"), para testar a múltipla escolha.
3. `npm run gabarito:build` junta as partes e gera:

| Arquivo (não versionado — conteúdo de terceiros) | Conteúdo |
|---|---|
| `samples/private/gabarito-unidade-ii.md` | 110 questões · 236 perguntas · 190 com resposta · 47 dependem de imagem |
| `samples/private/gabarito-iii-unidade.md` | 106 questões · 252 perguntas · 223 com resposta · 23 dependem de imagem |
| `samples/private/gabarito-*.json` | Mesmo conteúdo no **formato de importação v2** (87 + 91 questões com resposta) — validado pelo mesmo validador do app ✅ |

Os agentes também listaram trechos ambíguos para revisão humana (fotos desfocadas, rótulos repetidos "QUESTÃO 1" várias vezes, respostas copiadas de outra questão, anotações soltas de alunos). Esses casos estão nos relatórios e merecem uma passada humana antes de usar o gabarito como "verdade absoluta".

## 2. Como rodar

```bash
npm run gabarito:build            # (re)gera MD + JSON do gabarito
npm run eval:import               # avalia o segmentador determinístico (sem IA)
npm run eval:import -- --ai       # avalia o pipeline com OpenRouter (precisa OPENROUTER_API_KEY; 3 lotes/PDF por padrão)
npm run eval:import -- --ai --batches 20
```

Saídas: resumo no console + `samples/private/eval/relatorio-*.md` (lista de questões não encontradas, divergências de nº de perguntas, respostas mal anexadas).

## 3. Métricas

| Métrica | Definição |
|---|---|
| Recall (questões com texto) | Questões do gabarito **cujo conteúdo está na camada de texto** que foram detectadas |
| Precisão | Questões detectadas que correspondem a uma questão real |
| Mesmo nº de perguntas | Questões casadas em que o nº de perguntas bate com o gabarito |
| Similaridade do enunciado | Dice de palavras entre enunciado detectado e o do gabarito |
| Texto da pergunta correto | Perguntas cujo texto bate (Dice ≥ 0,6) |
| Resposta na pergunta certa | F1 de cobertura entre a resposta detectada e a do gabarito ≥ 0,6 (penaliza "engolir" a próxima pergunta) |

Questões que dependem de foto/esquema ficam fora do recall "com texto" — são o trabalho da etapa de **visão** (ou do agente externo).

## 4. Resultados — segmentador determinístico (sem IA), 2026-11-20

| PDF | Recall (com texto) | Precisão | Mesmo nº de perguntas | Enunciado | Pergunta correta | Resposta na pergunta certa |
|---|---|---|---|---|---|---|
| Unidade II.pdf | **92,1%** (63 c/ texto) | **96,2%** | 96,6% | 95,3% | 87,8% | 89,9% |
| III UNIDADE.pdf | **90,4%** (83 c/ texto) | **95,1%** | 90,7% | 97,8% | 91,3% | 95,0% |

Evolução durante a avaliação (mesmos PDFs):

| Versão | Recall U2 / U3 | O que mudou |
|---|---|---|
| v2 inicial | 68% / 70% | Modelo enunciado + perguntas; "?" + "Justifique." encerram a pergunta |
| + verbos de comando | 76% / 73% | Comandos sem "?" ("…discorra sobre a melhor conduta.") até 25 linhas; numeração "4.", "10a.", "2) … assinale" |
| + seções corrigidas | **92% / 90%** | Bug: o regex de seção "consumia" a linha seguinte e perdia títulos em linhas ímpares |

### O que ainda falha (e quem resolve)

| Caso | Exemplo | Quem resolve |
|---|---|---|
| Conteúdo só em imagem (70 questões nos 2 PDFs) | quadros POP-Q, enunciados fotografados, prints | Etapa de **visão** (páginas renderizadas → modelo multimodal) ou **agente externo** |
| Questões sem número/rótulo | "Maria tem 67 anos e informa…" no meio da seção | Etapa de **estruturação com IA** (o LLM recebe o bloco e separa) |
| Anotações de aluno que não são questões | "41: 1) Explicar os fenótipos de SOP…", "Dava o caso de CA de mama…" | IA marca como `descartados` ou revisão humana |
| Respostas em "A) B) C)" separadas das perguntas a/b/c | quadros POP-Q da Unidade II | Regra no prompt de estruturação (já incluída) |

> ⚠️ **Viés:** as regras foram ajustadas olhando estes mesmos dois PDFs. Para medir generalização, rode a avaliação em um **terceiro PDF** (de outra disciplina) antes de confiar nos números.

## 5. Avaliação com IA (OpenRouter, modelos `:free`) — 2026-11-20

O modo `--ai` roda o pipeline real (`server/ai/pipelines/import-graph.ts`: guard → segment → structure com grounding, fallback e prazo por passo) e compara com o gabarito. Custo: **US$0** (só modelos gratuitos).

```bash
npm run ai:ping                                       # chave, catálogo e 1 requisição real
npm run eval:import -- --ai --batches 12 --pdf u3     # amostra; --reuse recalcula sem novas chamadas
```

### 5.1 O que deu errado na 1ª tentativa (e a correção)

| Sintoma | Causa (medida com chamada crua ao `/chat/completions`) | Correção |
|---|---|---|
| "No output generated" em todos os modelos | Modelos gratuitos (ernie, nemotron, ling) têm **raciocínio obrigatório**: `finish_reason: length`, `reasoning_tokens: 8001`, conteúdo vazio. Não aceitam `reasoning.enabled=false` e ignoram `effort: low`/`max_tokens` | `maxOutputTokens` 24 mil (estruturação) e limites maiores nas demais tarefas — grátis nos `:free` |
| Lotes de 8 questões nunca terminavam | Cada questão consome ~4,8 mil tokens de raciocínio | **Lotes de ≤ 3 questões / 6 mil caracteres** |
| Um bloco "difícil" levou 248 s (3 modelos) | Cadeia de fallback sem limite total | **Prazo por passo** em `callStructured` (nenhuma tentativa começa sem ≥ 20 s restantes; timeout cortado ao que sobra) |
| Contagem de chamadas dobrada | Tentativas registradas 2× no fallback | Corrigido no grafo |
| Erros genéricos | — | Erros classificados por status HTTP (401/403/402 param tudo; 404/429/timeout → próximo modelo) e com a causa (campo do schema) |

### 5.2 Resultado — III UNIDADE.pdf, 12 lotes (21 questões do gabarito no trecho)

**12/12 chamadas corretas na 1ª tentativa** (todas pelo `baidu/ernie-5.5-flash-preview:free`), ~7–49 s por lote (mediana ~17 s), **0 fallbacks**.

| Mesmo trecho | Recall | Precisão | Nº de perguntas certo | Pergunta correta | Resposta na pergunta certa |
|---|---|---|---|---|---|
| **Com IA** | **100%** | **95,0%** | **100%** | **97,6%** | **94,9%** |
| Sem IA (segmentador) | 100% | 90,5% | 84,2% | 87,8% | 87,2% |

A IA melhora principalmente a **separação enunciado × perguntas** (+16 pontos no nº de perguntas certo) e o **texto das perguntas** (+10). Na Unidade II, os primeiros lotes caem nos quadros POP-Q (só imagem) — ali nem a IA de texto nem o segmentador acertam; é trabalho da etapa de **visão** (próximo passo a medir).

> Limitações: amostra de 21 questões de um PDF; o modelo gratuito pode mudar/cair (o fallback cobre). Repita `npm run eval:import -- --ai` periodicamente e antes de trocar modelos em `server/ai/models.ts`.

## 6. Achados que viraram correções no produto

| Achado | Correção |
|---|---|
| Modelo antigo tratava cada subitem como questão separada com "caso clínico" opcional | **Questão = Enunciado + Perguntas** em todo o sistema (contrato v2, banco, telas, pipeline, pontuação por pergunta) |
| Agentes escrevem "assunto" muito específico → 90 cards para 91 questões | Prompt exige assunto **amplo e idêntico** entre questões do mesmo tema; botão **"Agrupar por disciplina"** na revisão |
| Assuntos > 80 caracteres rejeitavam a importação inteira | Campos curtos tolerantes (truncam com "…") |
| Perguntas sem resposta no material (75 nos 2 PDFs) | Continuam no rascunho com selo "sem resposta — revise"; o JSON v2 exige resposta para salvar |
| Mesmo rótulo ("QUESTÃO 1") repetido em várias seções | IDs internos independentes do rótulo; rótulo guardado em `sourceLabel` |
