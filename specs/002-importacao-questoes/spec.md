# Spec 002 — Importação de questões (PDF com IA, agente externo, manual)

**Feature**: 002-importacao-questoes · **Status**: Pronta para implementação · **Fase**: Fase 1 MVP (Sprint S2) + Fase 2 (visão, distratores em lote, guardrail LLM)


> **Revisão 2026-11-20 (ADR-0009):** a estrutura passou a ser **Questão = Enunciado + Perguntas** (cada pergunta com a sua resposta discursiva e/ou alternativas). Onde esta spec diz "subitem com caso clínico/contexto", leia "pergunta da questão"; o contrato vigente é o [v2](./contracts/import-format-v2.md). Qualidade do importador medida contra o gabarito dos PDFs reais em [docs/10](../../docs/10-avaliacao-importador.md) (sem IA: ~90% recall, ~95% precisão). Novos requisitos: **FR-R1** o assunto sugerido deve ser amplo e repetido entre questões do mesmo tema; **FR-R2** a revisão oferece "Agrupar por disciplina" quando há cards demais; **FR-R3** campos curtos longos (assunto/rótulo) são truncados, não rejeitados; **FR-R4** o fluxo do agente externo aceita carregar arquivo (.json/.md/.txt). **FR-R5** (2026-11-20) o prompt do agente externo manda aproveitar as informações de organização do próprio material (sumário/índice "Questões × Temas", títulos de seção, texto-base compartilhado, gabarito em outra página): o assunto segue o nome do tema dado pelo material, na mesma grafia, sem fundir temas que o material separa; se o índice e o conteúdo divergirem, vale o tema do índice que corresponde ao conteúdo; o que foi aproveitado vai em `origem.observacoes`. Instruções dirigidas à IA continuam ignoradas.

## Contexto

Este é o **requisito principal** do produto. O estudante precisa transformar o próprio material, que costuma ser PDFs de questões já respondidas, em questões de simulado. Ele deve poder revisar, categorizar e corrigir tudo antes de salvar.

O que os PDFs de exemplo (`Unidade II.pdf`, `III UNIDADE.pdf`) mostraram:

- São quase sempre **casos clínicos discursivos**: um texto-base com subitens `a)`, `b)`, `c)…` e respostas longas. Questões objetivas aparecem pouco.
- Há **camada de texto**, então a extração local com pdf.js funciona sem IA. No `Unidade II.pdf` (85 páginas), o segmentador determinístico encontrou **141 questões/subitens, 135 com resposta**.
- **33 de 85 páginas têm imagens** (esquemas POP-Q, tabelas) e **9 parecem escaneadas** (pouco texto + imagem). Essas exigem modelo de visão, ou o método "agente externo".

Restrições que moldam a solução:

- **OpenRouter gratuito**: apenas modelos `:free`. O limite é 20 req/min, e 50 req/dia sem créditos ou 1000 req/dia após uma compra única de US$10. Por isso o pipeline trabalha em lotes de até 8 questões e o app tem orçamento global e por usuário.
- **Vercel Hobby**: corpo de requisição ≤ 4,5 MB e função ≤ 300 s. Por isso o PDF nunca sai do navegador (só o texto extraído é enviado) e o processamento é retomável em passos de ~240 s.

Por isso há **três métodos de entrada**, todos convergindo para a mesma tela de revisão em cards (Área › Disciplina · Assunto):

1. **PDF com IA**: o texto é extraído no navegador; o servidor roda o pipeline guard → segment → structure → classify → distractors → validate.
2. **Usar meu agente de IA**: o usuário copia um prompt pronto, roda no ChatGPT/Claude/Gemini com o PDF e cola o JSON. Esse JSON é validado contra o [contrato v2](./contracts/import-format-v2.md). Custo zero para o app e melhor resultado em PDFs com muitas imagens.
3. **Cadastro manual**: formulário com alternativas corretas e incorretas informadas pelo usuário ou geradas por IA.

Taxonomia: **Área** (ex.: Medicina; corresponde ao "Tema" do pedido original) › **Disciplina** (ex.: Ginecologia) › **Assunto** (ex.: Prolapso genital). Ver [docs/02-requisitos-usuario.md](../../docs/02-requisitos-usuario.md), [docs/05-pipeline-ia.md](../../docs/05-pipeline-ia.md) e [docs/09-decisoes-adr.md](../../docs/09-decisoes-adr.md).

## Histórias de usuário

### US1 — Importar via agente externo (P1)

Como estudante, quero copiar um prompt, usar a IA de minha preferência com meu PDF e colar o resultado, para importar questões mesmo de PDFs com imagens ou escaneados.

**Por que esta prioridade**: não gasta a cota de IA do sistema, lida com imagens melhor que modelos gratuitos e exercita todo o caminho validação → revisão → gravação. É o menor incremento que entrega o requisito principal de ponta a ponta.

**Teste independente**: copiar o prompt, colar o JSON de exemplo do contrato v2 e validar. Os cards aparecem; ao confirmar, as questões ficam no banco de questões e disponíveis para simulado.

**Cenários de aceite**
1. **Dado** a aba "Usar meu agente de IA", **quando** clico em "Copiar prompt", **então** o texto de `shared/prompts/external-agent.ts` vai para a área de transferência e o botão confirma "Copiado!".
2. **Dado** um JSON válido, colado puro ou dentro de um bloco ` ```json `, **quando** clico em "Validar e revisar", **então** vejo a tela de revisão com um card por combinação área/disciplina/assunto do JSON.
3. **Dado** um JSON inválido (ex.: objetiva com duas corretas), **quando** valido, **então** vejo a lista de erros com caminho (`questoes.0.alternativas`) e mensagem em pt-BR, e nada é salvo.
4. **Dado** um JSON com trechos de injeção (ex.: "ignore as instruções anteriores"), **quando** colo, **então** vejo um aviso do guardrail antes de validar, e os trechos chegam à revisão removidos e sinalizados.
5. **Dado** a resposta do agente em várias partes ("Parte 1/3…"), **quando** colo todos os blocos de uma vez, **então** o sistema junta as questões de todos os blocos válidos.

### US2 — Importar PDF com IA (P1)

Como estudante, quero arrastar meu PDF e receber as questões já separadas, categorizadas e com pontos-chave, sem copiar e colar nada.

**Por que esta prioridade**: é a experiência "mágica" pedida e o diferencial do produto. Fica atrás da US1 só porque depende do orçamento de IA e da resiliência do pipeline.

**Teste independente**: com `Unidade II.pdf`, a extração local mostra páginas, caracteres, questões detectadas e páginas com imagem. Após "Processar com IA", o progresso avança por etapas e a revisão mostra cards por assunto (Prolapso genital, Incontinência urinária…). Com a IA desligada, os mesmos itens aparecem marcados "Processado sem IA — revise".

**Cenários de aceite**
1. **Dado** um PDF de até 30 MB, **quando** o seleciono ou arrasto, **então** o texto é extraído **no navegador** (sem upload do arquivo), com progresso "Lendo página X de Y".
2. **Dado** a extração concluída, **quando** vejo o resumo, **então** ele mostra: questões/subitens detectados, quantos com resposta, páginas com imagens, páginas prováveis de escaneamento, achados do guardrail e uma estimativa de chamadas de IA (lotes de 8).
3. **Dado** que clico em "Processar com IA", **quando** o job roda, **então** vejo as etapas (Guardrail, Segmentação, Estruturação com IA, Categorização, Alternativas incorretas, Validação) com o estado atual, e o processamento continua sozinho entre chamadas de ~240 s.
4. **Dado** que um modelo falha ou devolve JSON inválido, **quando** o pipeline continua, **então** ele tenta reparar, depois troca de modelo e, no fim, aplica o fallback determinístico. Nenhuma questão detectada é perdida.
5. **Dado** que a cota diária de IA acabou no meio do job, **quando** recebo o aviso, **então** o progresso fica salvo, posso retomar depois e me é sugerido o método "agente externo".
6. **Dado** páginas com imagens, **quando** processo com IA, **então** o recorte de cada imagem útil é renderizado em JPEG no navegador (posso conferir em "Ver recortes") e enviado em lotes de até 3 (< 4,5 MB) ao modelo de visão. A transcrição entra no texto da questão certa (`[Imagem p. N: …]`, antes da segmentação) e em `descricao_imagem`; imagem não transcrita vira `[Imagem p. N]` com `tem_imagem` para eu revisar. Medição: [docs/10 §7](../../docs/10-avaliacao-importador.md).
7. **Dado** que fecho a aba durante o processamento, **quando** volto a "Importar", **então** vejo o job em andamento e posso continuar.

### US3 — Revisar e organizar em cards antes de salvar (P1)

Como estudante, quero ver as questões agrupadas em cards por Área › Disciplina · Assunto, movê-las entre cards, editar tudo e só então confirmar.

**Por que esta prioridade**: princípio II, em que a IA sugere e o usuário decide. Sem revisão, erros de segmentação e categorização contaminariam o banco e o ranking.

**Teste independente**: na revisão, arrastar uma questão de "Prolapso genital" para "Incontinência urinária" e conferir as contagens. Criar um card novo, editar área/disciplina/assunto/descrição, descartar uma questão, editar outra e confirmar. Só as questões mantidas são salvas, com a categoria final.

**Cenários de aceite**
1. **Dado** a revisão, **quando** arrasto uma questão (mouse, toque ou teclado) para outro card, **então** ela muda de card e as contagens se atualizam.
2. **Dado** qualquer questão, **quando** uso o seletor "Mover para…", **então** obtenho o mesmo resultado do arraste (alternativa acessível e mobile).
3. **Dado** um card, **quando** clico em editar, **então** posso alterar Área, Disciplina, Assunto (opcional) e Descrição. Área e Disciplina são obrigatórias.
4. **Dado** que clico em "Novo card", **quando** salvo, **então** surge um card vazio que aceita questões.
5. **Dado** que removo um card com questões, **quando** confirmo, **então** as questões vão para outro card (nunca são apagadas implicitamente).
6. **Dado** uma questão com sinalizações (guardrail, "Resposta não encontrada", "Processado sem IA", erro de validação), **quando** a vejo no card, **então** ela tem destaque visual e as etiquetas correspondentes.
7. **Dado** que edito uma questão, **quando** salvo, **então** posso alterar tipo, dificuldade, caso/texto-base, enunciado, alternativas (marcar a correta, adicionar, remover), resposta esperada, pontos-chave e visibilidade.
8. **Dado** que clico em "Confirmar e salvar N", **quando** a gravação termina, **então** vejo "N questões salvas!" com atalhos para "Criar simulado" e "Ver banco de questões".

### US4 — Gerar alternativas incorretas com IA (P2)

Como estudante, quero transformar discursivas em objetivas gerando distratores plausíveis, por questão ou em lote, para usar no simulado de múltipla escolha.

**Por que esta prioridade**: aumenta muito o aproveitamento dos PDFs discursivos em simulados objetivos, mas a questão discursiva já é utilizável sem isso.

**Teste independente**: numa discursiva com resposta esperada, clicar em "Gerar incorretas com IA". Surgem 1 correta (síntese da resposta) e 4 incorretas com explicação, marcadas "IA". Em lote, "Gerar alternativas p/ N discursivas" preenche todas as elegíveis.

**Cenários de aceite**
1. **Dado** uma questão sem resposta esperada nem alternativa correta, **quando** abro o editor, **então** o botão de gerar fica desabilitado, com explicação.
2. **Dado** que já escrevi a alternativa correta, **quando** gero, **então** a minha correta é preservada e só as incorretas são geradas.
3. **Dado** distratores gerados, **quando** os vejo, **então** cada um tem a etiqueta "IA" e uma explicação editável. Nenhum é "todas/nenhuma das anteriores", não há duplicatas e a correta não é desproporcionalmente maior.
4. **Dado** que a IA está indisponível, **quando** gero, **então** recebo uma mensagem clara e a questão continua discursiva.

### US5 — Cadastro manual (P2)

Como estudante, quero digitar questões uma a uma (objetivas ou discursivas), informando as alternativas incorretas ou gerando-as com IA.

**Por que esta prioridade**: cobre quem não tem PDF e serve de base de edição para os outros métodos (o mesmo editor). É também o primeiro CRUD da Sprint S1.

**Teste independente**: definir Área/Disciplina/Assunto, criar 2 questões (uma objetiva com 4 alternativas manuais, outra discursiva com distratores gerados), revisar e salvar.

**Cenários de aceite**
1. **Dado** o formulário, **quando** a objetiva não tem exatamente 1 correta ou tem menos de 2 alternativas preenchidas, **então** "Salvar questão" fica desabilitado com o motivo.
2. **Dado** uma discursiva sem resposta esperada, **quando** tento salvar, **então** sou impedido, com o motivo.
3. **Dado** a lista montada, **quando** clico em "Revisar N questão(ões)", **então** vou para a mesma tela de revisão em cards.

## Casos de borda

- PDF protegido por senha ou corrompido: mensagem "Não foi possível ler o PDF" sem travar a página.
- PDF > 30 MB ou > 400 páginas: pedir para dividir o arquivo.
- PDF 100% escaneado (nenhuma camada de texto): segmentação vazia. Oferecer visão (Fase 2) ou agente externo.
- Texto de página > 60.000 caracteres: truncar com aviso (limite do contrato da API).
- Texto total > 4,5 MB: dividir em vários jobs no cliente (não acontece com os PDFs de exemplo, ~330 KB de texto).
- Questões antes do primeiro "QUESTÃO N" (preâmbulo > 400 caracteres): viram o bloco `Q0` e são sinalizadas para revisão.
- Numeração repetida ("QUESTÃO 2" duas vezes): chaves `Q2` e `Q2-2`, sem colisão.
- Subitens fora de sequência (ex.: "a)" dentro de uma frase): só sequências a, b, c… no início de linha contam.
- Discursiva sem resposta no PDF: entra com a etiqueta "Resposta não encontrada — revise" e não pode ser salva sem resposta.
- Mesmo PDF importado duas vezes: duplicatas detectadas por `content_hash` (por dono) e ignoradas, com contagem no resumo final.
- Modelo devolve questões "inventadas" (não presentes no texto): reprovadas pelo grounding e reprocessadas ou caídas no fallback.
- Usuário fecha a aba durante o processamento: o job continua retomável (estado persistido a cada nó).
- Cota diária esgotada: 429 com mensagem, checkpoint mantido.
- Usuário com JSON gigante do agente (> 300 questões): erro de validação pedindo para dividir.
- Questão com imagem sem descrição: permitida, mas sinalizada "Depende de imagem". No simulado aparece o aviso.

## Requisitos funcionais

**Entrada**

- **FR-001**: O sistema DEVE oferecer três métodos de entrada (PDF com IA, agente externo, manual) que convergem para a mesma tela de revisão.
- **FR-002**: O sistema DEVE extrair o texto do PDF **no navegador** com pdf.js (worker carregado sob demanda), sem enviar o arquivo ao servidor, e reportar páginas, caracteres, páginas com imagem e páginas prováveis de escaneamento (`imagens > 0 && caracteres < 200`).
- **FR-003**: O sistema DEVE recusar PDFs > 30 MB e informar quando o arquivo não puder ser lido.
- **FR-004**: O sistema DEVE disponibilizar o prompt do agente externo (`shared/prompts/external-agent.ts`, espelhado em [docs/prompts/prompt-agente-externo.md](../../docs/prompts/prompt-agente-externo.md)) com botão de copiar.
- **FR-005**: O sistema DEVE aceitar o JSON colado puro ou em blocos ` ```json `. Quando houver vários blocos, DEVE validar cada um e unir as questões.
- **FR-006**: O sistema DEVE validar o JSON contra o [contrato v2](./contracts/import-format-v2.md) com o mesmo schema zod no cliente e no servidor, exibindo até 50 erros com caminho e mensagem em pt-BR.
- **FR-007**: O cadastro manual DEVE usar o mesmo editor de questão da revisão, com área/disciplina/assunto definidos para o lote.
- **FR-008**: O usuário DEVE poder escolher, por importação, a visibilidade padrão (privada/pública) e ajustá-la por questão.

**Guardrails**

- **FR-009**: O sistema DEVE aplicar o guardrail determinístico (`shared/guardrails.ts`) no cliente (aviso imediato) e **obrigatoriamente** no servidor sobre todo texto recebido, removendo os trechos de risco e sinalizando a questão.
- **FR-010**: Em páginas com risco "alto", o servidor DEVE consultar o classificador LLM de injeção (tarefa `guard`) quando houver orçamento. Na falha, mantém a remoção determinística.
- **FR-011**: Todo conteúdo do usuário enviado a modelos DEVE ir delimitado por `wrapUntrusted` com nonce por job, e os modelos do pipeline NÃO DEVEM ter ferramentas.
- **FR-012**: Todo texto vindo do usuário ou da IA DEVE ser renderizado como texto puro (sem HTML).

**Pipeline (PDF com IA)**

- **FR-013**: O servidor DEVE criar um job de importação persistido (`import_job`) e processá-lo com o grafo `guard → segment → structure (loop por lote) → classify (loop por lote) → [plan-distractors → distractors (loop)] → validate`, gravando checkpoint após cada nó.
- **FR-014**: Cada chamada a `POST /api/imports/:id/run` DEVE processar nós até ~240 s e devolver o estado. O cliente DEVE repetir a chamada até o status `revisao`, `falhou` ou um 429.
- **FR-015**: A segmentação DEVE ser determinística (`shared/segmenter.ts`) e agrupar blocos em lotes de até 8 itens e 10.000 caracteres.
- **FR-016**: A estruturação DEVE validar a saída por schema, exigir grounding (enunciado ≥ 50% e resposta ≥ 35% de trigramas presentes na fonte), tentar reparo 1x por modelo e percorrer a cadeia de modelos gratuitos de `server/ai/models.ts`.
- **FR-017**: Se todos os modelos falharem num lote, o sistema DEVE gerar rascunhos determinísticos dos blocos com a etiqueta "Processado sem IA — revise". Nenhum bloco detectado pode ser perdido.
- **FR-018**: A categorização DEVE preferir a taxonomia existente (global + do usuário), gerar uma descrição por card e um resumo por questão, e colocar questões não classificadas num card "Revisar categoria". O processamento DEVE ser em lotes de até 20 questões por chamada (na ordem do documento), reaproveitando a grafia dos assuntos já criados nos lotes anteriores e juntando no mesmo card o mesmo Área › Disciplina › Assunto.
- **FR-019**: A geração de distratores, quando solicitada, DEVE produzir 1 correta + 4 incorretas com explicação, aprovadas por `checkDistractors` (sem duplicatas, sem "todas/nenhuma das anteriores", sem correta desproporcional, sem distrator quase idêntico à correta).
- **FR-020**: Toda reserva de requisição de IA DEVE respeitar o orçamento global diário (`AI_DAILY_BUDGET`, padrão 900) e o limite por usuário (`AI_USER_DAILY_LIMIT`, padrão 60), registrando cada tentativa em `ai_call`.
- **FR-021**: Ao esgotar a cota, o sistema DEVE responder 429 com mensagem que sugere o agente externo e manter o checkpoint para retomada.
- **FR-022**: Para imagens das páginas, o cliente DEVE localizar cada imagem útil (posição + recorte do PDF), inserir `[[imagem pN-k]]` no texto da página e renderizar só o recorte em JPEG (lado maior ~1400 px, qualidade 0,75), enviando-o em lotes de ≤ 3 (< 4,5 MB) a `POST /api/imports/:id/images` antes de `/run`. O servidor DEVE transcrever com a cadeia `vision` (só `:free`), aplicar o guardrail na transcrição, não armazenar a imagem e inserir a transcrição na questão antes da segmentação, preenchendo `tem_imagem`/`descricao_imagem`. Falha de visão nunca perde a questão (vira `[Imagem p. N]`).

**Revisão**

- **FR-023**: A revisão DEVE exibir cards (Área › Disciplina · Assunto, descrição e contagem) com as questões, permitindo mover questões por arraste (ponteiro, toque e teclado) e pelo seletor "Mover para…".
- **FR-024**: O usuário DEVE poder criar, editar e remover cards. Remover um card DEVE mover as questões para outro card. O último card não pode ser removido.
- **FR-025**: O usuário DEVE poder editar e descartar qualquer questão, e gerar distratores por questão ou em lote para as discursivas elegíveis.
- **FR-026**: A barra de resumo DEVE mostrar o total de questões, cards, itens sinalizados e o arquivo de origem.

**Gravação**

- **FR-027**: `POST /api/imports/:id/commit` DEVE receber os cards e questões revisados, validar tudo de novo no servidor e gravar de forma atômica (`db.batch`): taxonomia (findOrCreate por slug), `question_group` por card, `question_case` por caso com subitens (`caso_id` + `contexto`), `question` com `case_order` e `alternative` com `position`.
- **FR-028**: O commit DEVE calcular `content_hash` (normalização de contexto + enunciado + resposta/alternativas), ignorar duplicatas do mesmo dono e informar quantas foram ignoradas.
- **FR-029**: O commit DEVE ser idempotente: um segundo commit do mesmo job retorna o resultado anterior sem duplicar.
- **FR-030**: Questões com erro de validação ou sem resposta (discursiva) NÃO DEVEM ser gravadas. A interface DEVE impedir a confirmação enquanto houver itens bloqueantes, ou oferecer "salvar só as válidas".

## Entidades-chave

- **ImportJob** (`import_job`): dono, origem (`pdf_ia | agente_externo | manual`), arquivo, status (`rascunho | processando | revisao | concluida | falhou | cancelada`), `state` (checkpoint do grafo: páginas, blocos, lotes pendentes, rascunhos, cards, avisos, log de IA), risco do guardrail, contagem de requisições de IA, erro.
- **Bloco**: unidade segmentada (caso + subitem), com `caseKey`, página e risco.
- **Rascunho de questão** (`DraftItem`): questão no formato v2 + id, bloco de origem, resumo e flags.
- **Card**: área, disciplina, assunto, descrição e ids das questões. Ao gravar vira `question_group`.
- **Area / Discipline**: taxonomia global (slug único).
- **QuestionCase**: texto-base compartilhado por subitens.
- **Question / Alternative**: questão final e alternativas (com `source: usuario | ia`).
- **AiCall**: telemetria e base do orçamento e do circuit breaker.

## Critérios de sucesso

- **SC-001**: Para `Unidade II.pdf`, a extração no navegador termina em ≤ 15 s num notebook intermediário e detecta ≥ 90% dos subitens com resposta (referência: 135/141 no protótipo).
- **SC-002**: Processar `Unidade II.pdf` com IA consome ≤ 25 requisições de IA (≈ 18 lotes de estruturação + classificação + guard) e conclui em ≤ 10 min com os modelos gratuitos disponíveis.
- **SC-003**: 0 questões detectadas perdidas em falha de IA. Teste com todos os modelos mockados falhando: o número de rascunhos é igual ao número de blocos.
- **SC-004**: ≥ 90% das questões estruturadas por IA passam no grounding na primeira tentativa no conjunto de avaliação (`server/ai/eval/`).
- **SC-005**: 100% dos casos de injeção do conjunto de teste do guardrail são sinalizados, e 0 instruções injetadas alteram a saída do pipeline (teste com prompts maliciosos dentro do PDF).
- **SC-006**: Um usuário consegue, sem ajuda, importar via agente externo e salvar 10 questões em ≤ 5 min (teste de usabilidade com 3 estudantes).
- **SC-007**: Reimportar o mesmo conteúdo cria 0 questões duplicadas.
- **SC-008**: A tela de revisão é operável só por teclado (mover questão, editar card, confirmar), sem rolagem horizontal em 375 px de largura.

## Fora de escopo

- Upload e armazenamento do PDF original (Vercel Blob fica como opção futura).
- OCR pago (`mistral-ocr`) e qualquer modelo não gratuito.
- Importar de Word, imagens soltas, Google Docs ou Anki (Fase 3+).
- Moderação/curadoria de questões públicas de terceiros (Fase 3, junto com turmas).
- Edição colaborativa de questões de outros usuários.
- Extração de imagens do PDF para exibir no simulado (a Fase 2 guarda só a descrição textual).

## Pontos em aberto

- [PRECISA ESCLARECER: a visibilidade padrão das questões importadas deve ser "pública" (como no protótipo) ou "privada"? Há implicações de direitos autorais para material de professores.]
- ~~Ao salvar com itens bloqueantes: impedir ou "salvar só as válidas"?~~ **Decidido (2026-11-20):** impedir a confirmação, listando os problemas, e oferecer a ação explícita "Tirar N questões com problema da importação" — nada é descartado sem o usuário pedir (T040).
- [PRECISA ESCLARECER: a geração de distratores no pipeline do PDF deve vir marcada por padrão (consome ~1 requisição a cada 6 discursivas) ou ficar opcional?]
