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
npm run eval:import -- --vision          # + etapa de visão (recortes das imagens → modelo grátis); ~1 chamada a cada 3 imagens
npm run eval:import -- --vision --reuse  # reaproveita as transcrições salvas (sem chamadas), com o pós-processamento atual
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

Questões que dependem de foto/esquema ficam fora do recall "com texto" — são o trabalho da etapa de **visão** (ou do agente externo), medidas à parte (§7):

| Métrica (questões com metadado "Imagem") | Definição |
|---|---|
| Detectadas | Casadas com alguma questão detectada (pelo texto, ou pelo conteúdo transcrito da imagem) |
| Conteúdo da imagem recuperado | POP-Q: **todos** os pontos do quadro certos na questão casada. Demais: a questão casada contém a transcrição (`[Imagem p. N…`) e ≥ 60% das palavras da questão do gabarito |
| POP-Q 100% certos / pontos POP-Q certos | Quadro exato (9/9) / fração de pontos certos **na questão certa** |
| OCR POP-Q | Melhor transcrição na mesma página (±1) contra o quadro do gabarito — mede a leitura do modelo **sem depender da segmentação** |

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
| Conteúdo só em imagem (70 questões nos 2 PDFs) | quadros POP-Q, enunciados fotografados, prints | Etapa de **visão** (recorte de cada imagem → modelo multimodal grátis) — medida na §7 — ou **agente externo** |
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

A IA melhora principalmente a **separação enunciado × perguntas** (+16 pontos no nº de perguntas certo) e o **texto das perguntas** (+10). Na Unidade II, os primeiros lotes caem nos quadros POP-Q (só imagem) — ali nem a IA de texto nem o segmentador acertam; é trabalho da etapa de **visão** (medida na §7).

> Limitações: amostra de 21 questões de um PDF; o modelo gratuito pode mudar/cair (o fallback cobre). Repita `npm run eval:import -- --ai` periodicamente e antes de trocar modelos em `server/ai/models.ts`.

## 6. Achados que viraram correções no produto

| Achado | Correção |
|---|---|
| Modelo antigo tratava cada subitem como questão separada com "caso clínico" opcional | **Questão = Enunciado + Perguntas** em todo o sistema (contrato v2, banco, telas, pipeline, pontuação por pergunta) |
| Agentes escrevem "assunto" muito específico → 90 cards para 91 questões | Prompt exige assunto **amplo e idêntico** entre questões do mesmo tema; botão **"Agrupar por disciplina"** na revisão |
| Assuntos > 80 caracteres rejeitavam a importação inteira | Campos curtos tolerantes (truncam com "…") |
| Perguntas sem resposta no material (75 nos 2 PDFs) | Continuam no rascunho com selo "sem resposta — revise"; o JSON v2 exige resposta para salvar |
| Mesmo rótulo ("QUESTÃO 1") repetido em várias seções | IDs internos independentes do rótulo; rótulo guardado em `sourceLabel` |

## 7. Etapa de visão (imagens das páginas) — 2026-11-20

Implementação: [docs/05 §5.1](05-pipeline-ia.md). Em resumo: cada imagem útil é localizada no PDF (matriz + recorte do pdf.js), o **recorte** vira JPEG (~40–100 KB) e vai, de 3 em 3, ao modelo de visão gratuito; a transcrição entra no texto da página **antes da segmentação** (`[Imagem p. N: POP-Q — …]` ou o texto da foto). Avaliação: o **mesmo nó `vision` do grafo**, com os recortes renderizados em Node (`scripts/pdf-images-node.ts`, `@napi-rs/canvas`) no lugar dos que o navegador envia.

```bash
npm run eval:import -- --vision            # visão + segmentador (compara com "sem visão" no mesmo gabarito)
npm run eval:import -- --vision --reuse    # recalcula com as transcrições salvas (0 chamadas)
npm run eval:import -- --ai --vision --reuse --batches 10 --pdf u2   # + IA de estruturação num trecho
```

### 7.1 Resultado final — segmentador + visão (rodada v3, 2026-11-20)

| | Unidade II **sem** visão | Unidade II **com** visão | III UNIDADE **sem** visão | III UNIDADE **com** visão |
|---|---|---|---|---|
| **Questões com imagem detectadas** | 36,2% (de 47) | **93,6%** | 13,0% (de 23) | **82,6%** |
| **Conteúdo da imagem recuperado** | 0% | **83,0%** | 0% | **47,8%** |
| Quadro POP-Q exato **na questão certa** | 0% (de 41) | **95,1%** (39/41) | — | — |
| Pontos POP-Q certos na questão certa | 0% | **95,6%** | — | — |
| OCR POP-Q (leitura, sem depender da segmentação) | — | **41/43 quadros exatos · 95,6% dos pontos** | — | — |
| Texto: recall | 92,1% | 92,1% | 90,4% | **91,6%** |
| Texto: precisão | 96,2% | 96,2% | 95,1% | **96,0%** |
| Texto: nº de perguntas / pergunta / resposta | 96,6 / 87,8 / 89,9% | 96,6 / 87,8 / 89,9% | 90,7 / 91,3 / 95,0% | 90,8 / 91,4 / 95,0% |

**As métricas de texto não pioraram** (U2 idênticas; U3 +1,2 recall, +0,9 precisão). Variância entre rodadas do modelo (mesmo código, respostas da rodada v2): U2 POP-Q exato na questão certa 92,7%, OCR 40/43; U3 precisão 95,0% e conteúdo recuperado 52,2% — ou seja, ±1 ponto nas métricas de texto e ±3–5 pontos nas de imagem de uma rodada para outra.

> A regra `dropCutoffTail` (fragmento de questão cortado na borda da foto) entrou depois da rodada v3 e foi medida reaplicando o pós-processamento às mesmas respostas do modelo (`--reuse`); todas as outras regras estavam ativas na rodada.

**Custo e tempo (rodada v3, sem cache):**

| | Unidade II | III UNIDADE |
|---|---|---|
| Imagens úteis / recortes JPEG | 46 / 1,8 MB | 18 / 1,6 MB (+0,4 MB de reenvio) |
| Lotes (requisições no orçamento) | 16 | 9 (6 + 3 reenvios individuais) |
| Tentativas no OpenRouter (com fallback) | 17 (16 ok) | 13 (7 ok) |
| Tempo total / mediana por lote de 3 | 664 s / ~32 s | 599 s (2 lotes esgotaram os 240 s) |
| Imagens transcritas | 46/46 | 17/18 (1 falhou nas 2 tentativas → `[Imagem p. N]`) |
| Modelos que responderam | só `nvidia/nemotron-3.5-super-vl:free` | idem |

Custo em dinheiro: **US$ 0**. No orçamento diário: ~1 requisição a cada 3 imagens (+1 por imagem que precisar de 2ª tentativa).

**Com a IA de estruturação (caminho de produção), trecho dos 10 primeiros lotes da Unidade II** (22 questões do gabarito, 18 dependem de imagem — é a parte dos quadros POP-Q):

| Mesmo trecho | Com imagem: detectadas | Quadro POP-Q exato na questão certa | Texto: recall (4 questões) | Precisão |
|---|---|---|---|---|
| Sem IA, sem visão | 61,1% | 0% | 50% | 100% |
| Sem IA + visão | 100% | 88,9% | 50% | 90,9% |
| **IA + visão** | **100%** | **88,9%** (= teto do OCR no trecho, 16/18) | **75%** | 91,3% |

Na 1ª tentativa a IA **omitiu** o quadro `[Imagem p. 15: POP-Q …]` de uma questão (estava na página seguinte) e caiu para 83,3%; agora o nó `structure` reanexa ao enunciado todo colchete de imagem do bloco que a IA não devolveu (`missingImageBrackets`). Em 1 de 10 lotes a IA reprovou no grounding (resposta não literal) e o lote caiu no fallback determinístico — sem perda de questão. 13 chamadas (9 ok), todas pelo `ernie-5.5-flash`.

### 7.2 Como chegamos lá (cada rodada com o modelo real)

| Rodada | Mudança | U2: detectadas · POP-Q exato na questão | U2: OCR POP-Q | U3: detectadas · conteúdo |
|---|---|---|---|---|
| sem visão | — | 36,2% · 0% | — | 13,0% · 0% |
| v1 | prompt inicial; recorte por imagem respeitando o *clip* do PDF | 61,7% · 41,5% | 34/43 | 87,0% · 52,2% |
| v2 | rótulo "QUESTÃO N" de dentro da imagem fora do colchete; texto + quadro → `texto` com linha `POP-Q — …`; rejeitar saída repetitiva | 87,2% · 41,5% | 33/43 | 82,6% · 52,2% |
| v2 + pós-processamento | recuperar quadro "achatado", `<br>` → quebra, unir enunciado-foto + respostas digitadas de mesmo rótulo, desempate por página no avaliador | 100% · 92,7% | 40/43 | 82,6% · 52,2% |
| **v3 (final)** | tudo acima, rodada do zero + corte de fragmento na borda | **93,6% · 95,1%** | **41/43** | **82,6% · 47,8%** |

(v1 e v2 "cru" foram medidos com o avaliador antigo, que dava o mesmo bônus a ±2 páginas; o desempate novo não muda nenhuma métrica sem visão.)

### 7.3 Onde o modelo gratuito falha (medido, não estimado)

| Falha | Onde | Tratamento |
|---|---|---|
| **Cadeia na prática tem 1 modelo**: gemma-4-31b/26b, ling-3.2-flash e particle-1 devolveram **429 do provedor** em todas as tentativas do dia; nemotron-3-nano-omni voltou vazio; gemma respondeu uma vez com JSON inválido | todas as rodadas | 2ª tentativa individual; o que sobrar vira `[Imagem p. N]` com `tem_imagem` (nunca perde a questão) |
| **Erro do provedor** no nemotron derruba o lote inteiro e os fallbacks esgotam os 240 s | 1–2 lotes por rodada | reenvio individual da imagem (recuperou 3/3 na U2 v1; 2/3 na U3 v3) |
| Quadro POP-Q "achatado" ("+2 Aa +1 Ba…", às vezes com `<br>`) mesmo pedindo o formato | pp. 24, 26, 28 da U2 | `recoverPopqGrids`: com os 9 rótulos na ordem e 9 valores, o k-ésimo valor vai para o k-ésimo rótulo |
| **Degeneração**: "QUESTÃO 2 2 2 2 2…" até o limite de tokens | U2 p. 26 e 28 (v1) | saída repetitiva reprova só aquela imagem → 2ª tentativa |
| Foto com enunciado **e** quadro partida em 2 imagens no PDF (o quadro fica cortado entre elas) | U2 pp. 5–7 | sem solução automática: as 2 transcrições entram, o quadro sai incompleto — são exatamente os **2 quadros que não batem** na v3 (U2-006, U2-007) |
| Foto mostra pedaços das questões vizinhas (cortadas na borda) | U2 pp. 5–6, U3 pp. 11, 101 | `dropCutoffTail` remove o fragmento final com reticências; o do início da foto fica (vira texto extra na questão anterior) |
| **"Completou" texto cortado**: a 1ª linha cortada de uma foto foi transcrita copiando a linha de baixo | U3 p. 11 | não detectável automaticamente — a revisão mostra a transcrição |
| Uma foto com 3 questões (caso comum + "QUESTÃO 17/18/19") ou várias questões numa página escaneada | U3 pp. 38, 81–82 | detectadas, mas o texto da foto fica numa questão só: conteúdo "recuperado" em só ~50% das questões com imagem da U3 |
| Figuras clínicas (lesão, colposcopia, gráfico) | U3 pp. 34, 35, 110 | descrição objetiva + legenda (3/3 coerentes na inspeção); o gabarito descreve com outras palavras, então só a detecção da questão é medida |

### 7.4 Conclusão

- Com visão, **quase todo o conteúdo que só existia em imagem passa a chegar ao importador**: 63 das 70 questões dependentes de imagem são detectadas (antes: 20) e os valores POP-Q chegam exatos na questão certa em 39/41 casos — sem custo em dinheiro e sem piorar o texto.
- O ponto fraco não é a leitura (95% dos pontos POP-Q certos), e sim **disponibilidade** (um modelo só respondendo; 2 de 25 lotes estouraram o prazo) e **fotos com várias questões**. Para PDFs só de fotos, o **agente externo** continua mais confiável.
- Antes de trocar a cadeia `vision` em `server/ai/models.ts`, rode `npm run eval:import -- --vision` (≈25 requisições para os 2 PDFs) e compare com a §7.1.

## 8. Pipeline completo com IA + visão (créditos OpenRouter) — 2026-11-20

Esta é a primeira rodada com **todos os lotes** dos dois PDFs (antes, até 12 lotes):

```
npm run eval:import -- --ai --vision --reuse --batches 999
```

As transcrições das imagens são reaproveitadas da rodada de visão. Ao todo foram ~145 chamadas de estruturação, mais ~23 de visão, com US$ 0 de custo.

| Métrica (IA + visão) | Unidade II (110 questões; 47 dependem de imagem) | III UNIDADE (106; 23 dependem de imagem) |
|---|---|---|
| Recall (texto) | **95,2%** (sem IA: 92,1%) | **91,6%** (sem IA: 90,4%) |
| Precisão | 95,5% (sem IA: 96,2%) | 93,3% (sem IA: 95,1%) |
| Nº de perguntas certo | 93,3% (sem IA: 96,6%) | **97,4%** (sem IA: 90,7%) |
| Enunciado | 95,7% | 98,8% |
| Pergunta | **95,5%** (sem IA: 87,8%) | **95,7%** (sem IA: 91,3%) |
| Resposta | **97,5%** (sem IA: 89,9%) | 92,3% (sem IA: 95,0%) |
| Questões de imagem detectadas | **97,9%** (sem visão: 36,2%) | **91,3%** (sem visão: 13,0%) |
| Conteúdo da imagem recuperado | 83,0% | **21,7%** (visão sem IA: 52,2%) |
| POP-Q 100% certo na questão certa | **95,1%** (39/41) | — |
| Chamadas (ok) / questões no fallback | 59 (51) / 2 | 84 (70) / 5 |

**Leitura:**
- A IA ganha onde o segmentador erra: o texto das perguntas, as respostas da U2 e a contagem de subitens da U3.
- A visão faz as questões de imagem aparecerem.
- Nada se perde: o que a IA não estrutura volta pelo fallback, sinalizado para revisão.

**Achado — conteúdo das imagens de TEXTO na III UNIDADE (21,7% com IA contra 52,2% sem IA):**
- 15 das 18 imagens da U3 são fotos/prints de texto. Elas entram no formato longo (`[Imagem p. N — texto da imagem:] … [Imagem p. N — fim]`).
- A salvaguarda `missingImageBrackets` só reanexa o formato curto (`[Imagem p. N: …]`).
- **Tentativa:** reanexar também o formato longo quando menos de 60% das palavras aparecem na saída. Resultado da nova rodada completa:
  - U3 melhorou pouco (conteúdo 26,1%, recall 94,0%);
  - a U2 piorou: POP-Q 78,0%, imagens detectadas 91,5%, precisão 91,2%.

  Parte da piora pode ser variância, porque nessa rodada o `ling-3.2-flash` respondeu 429 e os fallbacks mudaram. Mesmo assim, a mudança foi **revertida** pela regra "não piorar".
- **Hipótese em aberto:** a métrica de conteúdo da U3 olha `descricao_imagem`, e não o enunciado. A IA incorpora o texto da foto ao enunciado, o que é correto, mas some da descrição. Investigar antes de mexer no grafo.

**Variância observada:** entre duas rodadas completas iguais, menos a salvaguarda, as métricas de texto variaram ±2–4 pontos e as de imagem até 17 pontos na U2. Para decidir mudanças no pipeline, compare pelo menos 2 rodadas.
