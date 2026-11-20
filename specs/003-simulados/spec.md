# Spec 003 — Simulados (configuração, execução e gabarito)

**Feature**: 003-simulados · **Status**: Pronta para implementação · **Fase**: Fase 1 (MVP) — Sprint S3

Referências: [docs/02-requisitos-usuario.md](../../docs/02-requisitos-usuario.md) · [docs/07-pontuacao-e-ranking.md](../../docs/07-pontuacao-e-ranking.md) · [docs/04-arquitetura.md](../../docs/04-arquitetura.md) · protótipo em `src/features/simulado/*`

---


> **Revisão 2026-11-20 (ADR-0009):** cada questão sorteada traz **o enunciado e todas as suas perguntas** na mesma tela; "quantidade" conta questões. O filtro "tipo de questão" foi substituído por **formato de resposta** (`original` | `multipla` | `discursiva`, ver `shared/simulado.ts` → `presentAs`/`isEligible`): em `multipla`, só entram questões cujas perguntas têm alternativas (originais ou geradas por IA). Correção e pontos **por pergunta**; tempo **por questão**; tempo automático = 2 min por pergunta objetiva + 6 min por discursiva (mín. 5).

## Contexto

O simulado é o principal momento de estudo do produto. O estudante monta um simulado a partir do banco de questões (as suas e, se quiser, as da comunidade) e responde com cronômetro. Cada questão e o simulado inteiro têm o tempo medido. Há dois modos:

- **Prova**: questões sorteadas, tempo limite obrigatório, gabarito só no final, sem dicas. Vale **3×** os pontos.
- **Treino**: o estudante escolhe tudo (filtros por assunto, sem limite de tempo, confere a resposta a cada questão, pede dicas e explicações da IA). Vale **1×**.

O modo prova alimenta o ranking, então suas regras (sorteio, prazo, sigilo do gabarito e pontuação) precisam ser garantidas pelo **servidor** (Princípio IV). O cliente só exibe o que o servidor permite.

O banco tem questões **objetivas** (alternativas A–E) e **discursivas** (resposta esperada + pontos-chave), muitas vezes como subitens (a, b, c…) de um mesmo caso clínico. Uma discursiva que tem alternativas (por exemplo, geradas pela IA na importação) **vira objetiva** quando o simulado não aceita discursivas.

## Histórias de usuário

### US1 — Fazer um simulado no modo prova (P1)

Como estudante, quero gerar um simulado aleatório com tempo limite e ver o gabarito só no final, para treinar como na prova real e pontuar no ranking.

**Por que esta prioridade**: é o que diferencia o produto e a principal fonte de pontos do ranking. Sem esta história não há MVP.

**Teste independente**: com um banco de pelo menos 10 questões de uma área, criar uma prova, responder, deixar o tempo acabar ou finalizar, e conferir que o gabarito só aparece depois e que os pontos chegam ao ledger.

**Cenários de aceite**
1. **Dado** um banco com ≥ 10 questões em Medicina, **quando** escolho "Modo prova", Área = Medicina, 10 questões e tempo automático, **então** o sistema sorteia 10 questões no servidor, define o prazo e abre o executor com contagem regressiva.
2. **Dado** uma prova em andamento, **quando** consulto a API da tentativa, **então** a resposta não traz o gabarito, as explicações nem as respostas esperadas.
3. **Dado** uma prova em andamento, **quando** o tempo chega a zero, **então** o simulado é finalizado automaticamente e as respostas enviadas após o prazo (+15 s de tolerância) são ignoradas.
4. **Dado** uma prova finalizada, **quando** abro o resultado, **então** vejo acerto, pontos com o detalhamento (base, ×3, bônus de tempo), tempo total, tempo médio, questão mais demorada e o gabarito comentado.
5. **Dado** uma prova com menos de 10 questões, **quando** ela é finalizada, **então** os pontos aparecem no resultado mas o simulado **não** conta para o ranking, e o resumo da configuração avisa isso antes de começar.
6. **Dado** que o cliente enviou `reveal: "imediato"` ou `aiHints: true` numa prova, **quando** o servidor cria a tentativa, **então** força `reveal = "final"` e `aiHints = false`.

### US2 — Fazer um simulado de treino com correção a cada questão (P1)

Como estudante, quero filtrar por assunto, conferir a resposta logo após responder e pedir dicas à IA, para aprender enquanto pratico.

**Por que esta prioridade**: é o uso diário (estudo focado) e o caminho natural depois de importar questões.

**Teste independente**: criar um treino em "Prolapso genital", responder uma objetiva, confirmar e ver certo/errado com as explicações. Numa discursiva, ver a resposta esperada e se autocorrigir pelo checklist.

**Cenários de aceite**
1. **Dado** o modo treino, **quando** seleciono Disciplina = Ginecologia e Assunto = "Prolapso genital", **então** só entram questões desse assunto e o resumo mostra quantas estão disponíveis.
2. **Dado** "Revelar a cada questão" ativo, **quando** escolho uma alternativa e clico em "Confirmar resposta", **então** a resposta fica travada e vejo a correta em verde, a minha em vermelho (se errei) e as explicações de cada alternativa.
3. **Dado** uma discursiva no treino, **quando** clico em "Ver resposta esperada e corrigir", **então** vejo a resposta esperada e o checklist de pontos-chave. Ao confirmar, a nota é a fração de pontos marcados, com `gradedBy = checklist`.
4. **Dado** que revelei a resposta esperada sem ter escrito nada, **quando** a questão é pontuada, **então** ela vale 0 ponto (`revealedBeforeAnswer`).
5. **Dado** "Dicas com IA" ativo, **quando** clico em "Pedir dica" antes de responder, **então** recebo uma dica que não revela a resposta e a questão passa a valer 50% (`usedHint`).
6. **Dado** "Revelar ao final" no treino, **quando** respondo, **então** posso trocar a resposta até finalizar e o gabarito aparece só no resultado.

### US3 — Gabarito, correção posterior e "treinar o que errei" (P2)

Como estudante, quero revisar o gabarito comentado, corrigir minhas discursivas depois (por checklist ou pela IA) e gerar um treino só com os assuntos que errei.

**Por que esta prioridade**: fecha o ciclo de aprendizado, mas o MVP funciona sem ela (US1 e US2 já mostram o resultado).

**Teste independente**: finalizar uma prova com discursivas, corrigir uma pelo checklist e outra pela IA, ver os pontos recalculados e clicar em "Treinar o que errei".

**Cenários de aceite**
1. **Dado** um resultado com discursivas pendentes, **quando** abro o resultado, **então** um aviso informa quantas aguardam correção e que o checklist vale 50% e a IA 100% dos pontos.
2. **Dado** uma discursiva pendente, **quando** marco os pontos-chave e confirmo a autocorreção, **então** a nota da questão e a pontuação total são recalculadas no servidor e o ledger recebe um lançamento de ajuste.
3. **Dado** uma discursiva pendente com texto, **quando** clico em "Corrigir com IA", **então** recebo a nota (0–1), os pontos atendidos e um feedback, e a pontuação é atualizada.
4. **Dado** um resultado com erros, **quando** clico em "Treinar o que errei", **então** é criado um treino (revelar a cada questão, dicas ativas, sem tempo) restrito aos assuntos das questões erradas.
5. **Dado** uma questão objetiva no gabarito, **quando** clico em "Explicar alternativas com IA", **então** vejo por que cada alternativa está certa ou errada (spec 005).

### US4 — Configuração avançada (P3)

Como estudante, quero priorizar as questões que errei, misturar as minhas questões com as da comunidade e escolher o tipo de questão.

**Por que esta prioridade**: melhora a qualidade do estudo, mas há alternativa manual (filtrar por assunto).

**Teste independente**: com histórico de erros, ativar "Priorizar o que errei" e verificar que as questões erradas aparecem primeiro.

**Cenários de aceite**
1. **Dado** "Só as minhas", **quando** o simulado é criado, **então** só entram questões em que `owner_id` é o usuário.
2. **Dado** "Minhas + comunidade", **quando** o simulado é criado, **então** entram as minhas questões e as **públicas** de outros usuários, nunca as privadas de terceiros.
3. **Dado** apenas o tipo "Objetivas", **quando** há discursivas com pelo menos 2 alternativas e exatamente uma correta, **então** elas entram como objetivas.
4. **Dado** "Priorizar o que errei", **quando** o simulado é criado, **então** primeiro entram as questões com última resposta de nota < 0,5, e o restante é completado por sorteio.

## Casos de borda

- **Filtros sem resultado**: o botão "Começar" fica desabilitado e a API devolve `422` com mensagem clara.
- **Quantidade maior que o disponível**: usa todas as disponíveis e o resumo mostra "N de M".
- **Subitens de um caso**: se um subitem é sorteado, os outros sorteados do mesmo caso ficam juntos e em ordem (a, b, c), com o caso exibido acima. Em [PRECISA ESCLARECER 1] decide-se se sortear um subitem puxa o caso inteiro.
- **Questão excluída ou tornada privada depois do sorteio**: a tentativa guarda os ids. A questão continua visível naquela tentativa (snapshot) e é omitida de novos sorteios.
- **Aba fechada ou queda de rede no meio da prova**: as respostas já foram salvas incrementalmente. Ao reabrir, o executor retoma com o tempo restante calculado pelo servidor (`deadlineAt - now`).
- **Relógio do cliente adulterado**: o tempo oficial é o do servidor (`startedAt`, `deadlineAt`). O `timeMs` por questão vem do cliente, mas a soma é limitada a `finishedAt - startedAt`.
- **Duas abas na mesma prova**: as respostas são idempotentes por `(attemptId, questionId)` e a última escrita vence. O finish também é idempotente.
- **Finalizar sem responder**: questões em branco valem 0 (objetiva: `score = 0`; discursiva sem texto: `score = 0`, não fica pendente).
- **Treino sem limite de tempo**: o cronômetro conta para cima e nunca auto-finaliza.
- **Tentativa abandonada** (não finalizada): não pontua e aparece no histórico como "não finalizado". É expirada após 24 h.
- **Prova com discursivas**: os pontos das discursivas só entram quando forem corrigidas. O ledger recebe lançamentos de ajuste.

## Requisitos funcionais

**Configuração**
- **FR-001**: O sistema DEVE oferecer os modos **prova** e **treino**, com multiplicadores ×3 e ×1 (`shared/scoring.ts`).
- **FR-002**: O sistema DEVE permitir escolher a fonte: "só as minhas" ou "minhas + comunidade" (só questões públicas de terceiros).
- **FR-003**: O sistema DEVE permitir filtrar por Área (uma ou todas), Disciplinas (várias; nenhuma significa todas) e, no treino, Assuntos (vários).
- **FR-004**: O sistema DEVE permitir escolher os tipos (objetiva/discursiva, pelo menos um). Discursivas com alternativas válidas entram como objetivas quando discursivas não são aceitas (`presentAs`).
- **FR-005**: O sistema DEVE permitir escolher a quantidade (1–100), limitada às questões disponíveis, e mostrar a contagem antes de começar.
- **FR-006**: O sistema DEVE oferecer tempo limite automático (2 min por objetiva + 6 min por discursiva, mínimo 5 min) ou personalizado (1–600 min). Na prova o tempo é obrigatório; no treino é opcional.
- **FR-007**: No treino, o sistema DEVE permitir escolher "revelar a cada questão" ou "ao final", "dicas com IA" e "priorizar o que errei".
- **FR-008**: O sistema DEVE mostrar um resumo antes de começar: questões, tempo, quando o gabarito aparece, dicas, multiplicador, pontuação máxima estimada e o aviso de que provas com menos de 10 questões não contam para o ranking.

**Regras no servidor**
- **FR-009**: O servidor DEVE sortear as questões (`ORDER BY random()` com filtros) e gravar a lista na tentativa. O cliente não escolhe as questões da prova.
- **FR-010**: Na prova, o servidor DEVE forçar `reveal = final`, `aiHints = false` e `timeLimitMin` não nulo.
- **FR-011**: O servidor DEVE calcular `deadlineAt = startedAt + timeLimit + 15 s` e ignorar respostas recebidas depois desse prazo.
- **FR-012**: O servidor NÃO DEVE enviar o gabarito (`correct`, `explanation`, `expectedAnswer`, `keyPoints`) de uma prova em andamento. No treino com revelação imediata, o gabarito de uma questão só é enviado via `reveal` daquela questão.
- **FR-013**: O servidor DEVE salvar cada resposta de forma incremental e idempotente (`PUT …/answers/:questionId`), somando `timeMs`.
- **FR-014**: O servidor DEVE corrigir as objetivas automaticamente na finalização e calcular a pontuação com `scoreSimulado` (`shared/scoring.ts`), gravando em `attempt` e no `points_ledger`.
- **FR-015**: A finalização DEVE ser idempotente: chamar duas vezes não gera pontos duplicados.

**Executor**
- **FR-016**: O executor DEVE mostrar o tempo total (regressivo se houver limite) e o tempo da questão atual, e registrar o tempo gasto em cada questão.
- **FR-017**: O executor DEVE finalizar automaticamente quando o tempo acabar.
- **FR-018**: O executor DEVE oferecer um navegador de questões com estados (atual, respondida, marcada para revisar e, no treino imediato, certa/errada).
- **FR-019**: O executor DEVE permitir marcar a questão para revisar, riscar alternativas e usar os atalhos A–E (escolher) e ←/→ (navegar), ignorando os atalhos quando o foco está num campo de texto.
- **FR-020**: O executor DEVE exibir o caso/texto-base e a descrição da imagem (se houver) acima do enunciado e manter os subitens do mesmo caso juntos e em ordem.
- **FR-021**: O executor DEVE pedir confirmação antes de finalizar (informando quantas questões estão em branco) e antes de sair sem finalizar.

**Resultado**
- **FR-022**: O resultado DEVE mostrar acerto (%), acertos/total, pontos (base, bônus de tempo, multiplicador), se conta para o ranking, tempo total, tempo médio por questão e a questão mais demorada.
- **FR-023**: O resultado DEVE listar o gabarito por questão com status, a resposta do estudante, a correta, o tempo e um detalhamento expansível com explicações.
- **FR-024**: O resultado DEVE mostrar o desempenho por Disciplina · Assunto.
- **FR-025**: O resultado DEVE permitir corrigir discursivas pendentes por checklist (peso 0,5) ou pela IA (peso 1), recalculando a pontuação no servidor.
- **FR-026**: O resultado DEVE oferecer "Treinar o que errei" (cria um treino com os assuntos das questões com nota < 0,5).
- **FR-027**: O sistema DEVE listar o histórico de simulados (data, modo, questões, acerto, pontos, link para o gabarito).

## Entidades-chave

- **SimuladoConfig** (`shared/domain.ts`): modo, fonte, filtros, tipos, quantidade, tempo, revelação, dicas, prioridade de erros.
- **Attempt** (`attempt`): tentativa com `config`, `questionIds` (ordem), `timeLimitMs`, `startedAt`, `deadlineAt`, `finishedAt`, `totalTimeMs`, `accuracy`, `points`, `countsForRanking`.
- **AttemptAnswer** (`attempt_answer`): resposta por questão (`choiceId` ou `text`), `score` 0–1, `gradedBy` (auto/checklist/ia), `timeMs`, `revealedBeforeAnswer`, `usedHint`, `flagged`.
- **PointsLedger** (`points_ledger`): lançamentos de pontos (finalização e ajustes de correção).
- **Question / Alternative / QuestionCase**: conteúdo (spec 002).

## Critérios de sucesso

- **SC-001**: Em 100% das provas, nenhuma resposta da API expõe `correct`, `expectedAnswer`, `keyPoints` ou `explanation` antes da finalização (teste automatizado de contrato).
- **SC-002**: Respostas enviadas mais de 15 s depois do `deadlineAt` são ignoradas em 100% dos casos (teste de integração).
- **SC-003**: Criar o simulado (clique em "Começar" até a 1ª questão visível) leva p95 < 1,5 s com 5.000 questões no banco.
- **SC-004**: O tempo por questão registrado difere menos de 2 s do tempo real em teste manual com 10 questões.
- **SC-005**: Recarregar a página no meio de uma prova não perde nenhuma resposta já confirmada e o tempo restante continua correto (±2 s).
- **SC-006**: A pontuação mostrada no resultado é idêntica à gravada no ledger em 100% dos casos (mesma função `scoreSimulado`).
- **SC-007**: O executor é utilizável em tela de 375 px sem rolagem horizontal e com navegação por teclado completa.

## Fora de escopo

- Simulados compartilhados ou competitivos em tempo real entre turmas (Fase 3).
- Caderno de erros persistente e flashcards (Fase 3). Aqui só existem "Treinar o que errei" e "Priorizar o que errei".
- Pausar a prova (o cronômetro da prova não pausa).
- Questões com imagem renderizada (só a descrição textual no MVP; imagem real na Fase 2).
- Modo offline.

## Pontos em aberto

1. `[PRECISA ESCLARECER: sortear um subitem de caso clínico deve puxar todos os subitens do caso (contando para a quantidade), ou só os sorteados ficam agrupados?]` Proposta: puxar o caso inteiro só na prova e permitir subitens soltos no treino.
2. `[PRECISA ESCLARECER: o tempo automático deve usar 2 min/objetiva e 6 min/discursiva (padrão atual) ou ser configurável por área, por exemplo Medicina com 3 min/objetiva?]`
3. `[PRECISA ESCLARECER: tentativas abandonadas devem expirar em 24 h, ou o usuário pode retomar um treino dias depois?]`
4. `[PRECISA ESCLARECER: na prova, permitir voltar a questões anteriores (padrão atual: sim, como em prova de papel) ou seguir só em frente?]`
