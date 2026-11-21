# Spec 004 — Dashboard de estatísticas e ranking

**Feature**: 004-dashboard-ranking · **Status**: Pronta para implementação · **Fase**: Fase 1 (MVP) — Sprint S3

Referências: [docs/07-pontuacao-e-ranking.md](../../docs/07-pontuacao-e-ranking.md) · [docs/02-requisitos-usuario.md](../../docs/02-requisitos-usuario.md) · regras em `shared/scoring.ts` · protótipo em `src/features/dashboard/DashboardPage.tsx`, `src/components/RankingPanel.tsx`, `src/features/ranking/RankingPage.tsx`

---

## Contexto

Depois de logar, o estudante cai no **painel**. Ele precisa ver em segundos como está indo (acerto, nota, evolução, pontos fracos) e o que fazer a seguir. À **direita** fica o painel de **ranking**, que ordena os estudantes pela pontuação ganha em simulados. Pedido original: "simulados estilo prova valem muito mais pontos que simulados de treino".

Pontos e nota são coisas diferentes:
- **Pontuação (XP)**: acumulada a partir do `points_ledger` e usada para ordenar o ranking. Premia volume e o modo prova.
- **Nota de desempenho (0–10)**: acurácia ponderada dos últimos 30 dias, com prova pesando 2 e treino 1 (`performanceGrade`). Mede qualidade, aparece no dashboard e serve de desempate no ranking.

## Regras de pontuação (resumo normativo de `shared/scoring.ts`)

| Regra | Valor |
|---|---|
| Base por acerto | Fácil 10 · Média 15 · Difícil 20 (× fração de acerto 0–1) |
| Multiplicador de modo | Prova ×3 · Treino ×1 |
| Corretor da discursiva | Automático/IA ×1 · Checklist (autodeclarado) ×0,5 |
| Questão criada pelo próprio usuário | ×0,5 |
| Mesma questão respondida de novo em < 7 dias | ×0,25 |
| Treino: dica de IA antes de responder | ×0,5 |
| Treino: viu a resposta antes de responder | ×0 |
| Prova: bônus de tempo | até +20% × (fração de tempo restante) × acurácia |
| Prova com < 10 questões | não conta para o ranking |
| Erro / em branco | 0 (sem pontuação negativa) |

## Histórias de usuário

### US1 — Ver minhas estatísticas no painel (P1)

Como estudante, quero ver no painel minha pontuação, minha nota, acerto médio, simulados feitos e minha evolução, para saber onde estou e o que estudar.

**Por que esta prioridade**: é a primeira tela depois do login e materializa o valor do produto ("estou melhorando?").

**Teste independente**: com 3 simulados finalizados em assuntos diferentes, abrir o painel e conferir cada número contra um cálculo manual sobre o banco.

**Cenários de aceite**
1. **Dado** um usuário com simulados finalizados, **quando** abre o painel, **então** vê os cartões: Pontuação (com posição no ranking), Acerto médio (com total de questões), Simulados feitos (com nº de provas), Tempo médio por questão, Sequência de dias (com recorde) e Minhas questões.
2. **Dado** respostas nos últimos 30 dias, **quando** a nota é calculada, **então** ela é igual a `performanceGrade(itens)` (prova peso 2) com uma casa decimal, e o painel mostra a variação em relação à semana anterior.
3. **Dado** respostas por assunto, **quando** vejo o "Mapa de desempenho", **então** cada assunto mostra o % de acerto com cor (verde ≥ 75%, amarelo ≥ 60%, vermelho < 60%) e o número de questões respondidas.
4. **Dado** um assunto com o pior acerto (mínimo de 2 respostas; empate → o mais respondido), **quando** abro o painel, **então** o destaque sugere "Seu ponto mais fraco agora é X" e oferece o CTA de treino focado já filtrado.
5. **Dado** atividade nos últimos 28 dias, **quando** vejo o heatmap, **então** cada dia mostra a intensidade por nº de questões respondidas (fuso de Brasília).
6. **Dado** um usuário novo sem dados, **quando** abre o painel, **então** vê estados vazios com CTA para "Importar questões" e "Fazer o primeiro simulado", sem zeros enganosos (nota exibida como "—").

### US2 — Painel de ranking à direita (P1)

Como estudante, quero ver ao lado do painel o ranking dos estudantes por pontuação (semana, mês e geral) com a minha posição, para me motivar.

**Por que esta prioridade**: é um requisito explícito do usuário e o motor de engajamento.

**Teste independente**: com 12 usuários com lançamentos no ledger em datas variadas, alternar entre semana/mês/geral e conferir a ordem e os totais contra uma query manual.

**Cenários de aceite**
1. **Dado** o painel aberto em tela ≥ 1280 px, **quando** a página carrega, **então** o ranking aparece fixo na coluna direita. Em telas menores ele aparece abaixo do conteúdo.
2. **Dado** a aba "Semana", **quando** o ranking é calculado, **então** soma os pontos do ledger desde segunda-feira 00:00 (America/Sao_Paulo). "Mês" usa o dia 1 do mês e "Geral" usa tudo.
3. **Dado** que estou fora do top N, **quando** vejo o painel, **então** minha linha aparece fixada abaixo do top N com a minha posição real.
4. **Dado** dois estudantes com os mesmos pontos, **quando** são ordenados, **então** desempata a maior nota de desempenho e depois quem chegou primeiro à pontuação.
5. **Dado** a página completa de ranking, **quando** a abro, **então** vejo o pódio (1º, 2º, 3º), a tabela com posição, nome, instituição/curso, simulados, nota e pontos, e posso filtrar por Área.
6. **Dado** que desativei "Aparecer no ranking" no perfil, **quando** outro usuário vê o ranking, **então** eu não apareço, mas continuo vendo a minha posição privada.

### US3 — Entender e confiar na pontuação (P2)

Como estudante, quero saber como os pontos são calculados e ter certeza de que ninguém trapaceia, para que o ranking seja justo.

**Por que esta prioridade**: sem confiança o ranking desmotiva, mas o MVP pode lançar com a explicação estática.

**Teste independente**: tentar pontuar via API com payload forjado (pontos no corpo, prazo vencido, questão própria em loop) e verificar que o ledger não aceita.

**Cenários de aceite**
1. **Dado** o painel ou o resultado, **quando** clico em "Como a pontuação é calculada", **então** vejo a tabela de regras desta spec.
2. **Dado** uma requisição que envia `points` no corpo, **quando** o servidor processa, **então** ignora o campo e calcula a partir das respostas.
3. **Dado** a mesma questão respondida 3 vezes em 7 dias, **quando** pontua, **então** só a primeira vale integral e as seguintes valem ×0,25.
4. **Dado** um usuário que cria 100 questões fáceis e faz treinos só com elas, **quando** pontua, **então** cada acerto vale no máximo 10 × 0,5 = 5 pontos.

## Casos de borda

- **Usuário sem nenhum simulado**: aparece no ranking só com pontos > 0. A posição é "—".
- **Correção posterior de discursiva**: gera um lançamento de ajuste no ledger com data da **correção** (pode cair na semana seguinte; aceitável e documentado).
- **Simulado finalizado exatamente na virada da semana**: conta para o período do `created_at` do lançamento (horário do servidor, convertido para BRT).
- **Exclusão de conta (LGPD)**: os lançamentos do ledger são apagados em cascata e o ranking é recalculado naturalmente.
- **Questão excluída depois de respondida**: as estatísticas históricas permanecem (as respostas mantêm a referência; soft delete).
- **Empate total** (pontos, nota e data): ordenar por `user_id` para ter estabilidade.
- **Sequência de dias**: um dia conta se houver ≥ 1 questão respondida em simulado finalizado (fuso BRT). Hoje sem atividade não quebra a sequência até 23:59.

## Requisitos funcionais

**Painel**
- **FR-001**: O sistema DEVE exibir a Pontuação total e a posição no ranking geral.
- **FR-002**: O sistema DEVE exibir a Nota de desempenho (0–10, 1 casa) = `performanceGrade` das respostas corrigidas dos últimos 30 dias, com variação semanal. Com menos de 10 respostas, mostrar "—" e "faça mais questões".
- **FR-003**: O sistema DEVE exibir Acerto médio (%) e total de questões respondidas, Simulados finalizados (com quantos foram provas), Tempo médio por questão, Sequência de dias (atual e recorde) e nº de Minhas questões.
- **FR-004**: O sistema DEVE exibir o mapa de desempenho por Disciplina › Assunto com % de acerto, nº de respostas e cor por faixa.
- **FR-005**: O sistema DEVE destacar o assunto mais fraco (menor acerto entre os assuntos com ao menos 2 respostas; empate → o mais respondido) com CTA de treino focado pré-configurado.
- **FR-006**: O sistema DEVE exibir o heatmap de atividade dos últimos 28 dias e o gráfico de evolução do acerto dos últimos 10 simulados, distinguindo prova de treino.
- **FR-007**: O sistema DEVE listar os últimos 5 simulados (título, data, modo, questões, acerto, tempo, pontos).

**Ranking**
- **FR-008**: O sistema DEVE calcular o ranking somando `points_ledger.points` por usuário nos períodos semana (segunda 00:00 BRT), mês (dia 1 00:00 BRT) e geral.
- **FR-009**: O sistema DEVE exibir o painel de ranking na coluna direita do painel (≥ 1280 px) com top 8, abas de período e a linha do usuário fixada quando estiver fora do top.
- **FR-010**: O sistema DEVE oferecer a página de ranking completa com pódio, top 50, filtro por Área e o card explicativo das regras.
- **FR-011**: O sistema DEVE ordenar por pontos desc, depois nota desc, depois data do último lançamento asc, depois `user_id`.
- **FR-012**: O sistema DEVE respeitar `profile.show_in_ranking = false` (LGPD/opt-out), ocultando o usuário dos rankings públicos.
- **FR-013**: O sistema DEVE exibir no ranking só nome de exibição, avatar e instituição/curso. O e-mail nunca aparece.

**Integridade**
- **FR-014**: Os pontos DEVEM ser calculados somente no servidor com `shared/scoring.ts`. Qualquer campo de pontos enviado pelo cliente é ignorado.
- **FR-015**: O `points_ledger` DEVE ser append-only: correções geram lançamentos de ajuste e nunca `UPDATE`/`DELETE` (exceto exclusão de conta).
- **FR-016**: O servidor DEVE aplicar as regras anti-farm (questão própria, repetição em 7 dias, dica, revelação, autocorreção, prova mínima).
- **FR-017**: O servidor DEVE limitar a criação de simulados por usuário (ex.: 60/hora) para impedir automação.

## Entidades-chave

- **PointsLedger** (`points_ledger`): `user_id`, `attempt_id`, `area_id`, `points`, `reason` (`simulado:prova`, `simulado:treino`, `ajuste:correcao`), `created_at`.
- **Attempt / AttemptAnswer**: fonte das estatísticas (acurácia, tempos, assuntos).
- **Profile** (`profile`): `display_name`, `institution`, `course`, `show_in_ranking`.
- **RankingEntry** (`shared/domain.ts`): visão agregada (userId, name, avatar, institution, points, grade, simulados).
- **DashboardStats** (DTO a criar): KPIs, mapa por assunto, heatmap, evolução, últimos simulados.

## Critérios de sucesso

- **SC-001**: `GET /api/me/dashboard` responde em p95 < 400 ms com 2.000 respostas do usuário.
- **SC-002**: `GET /api/ranking` responde em p95 < 300 ms com 5.000 usuários e 200 mil lançamentos (com cache de 60 s).
- **SC-003**: Os números do painel batem 100% com as queries de referência do teste de integração (seed fixa).
- **SC-004**: Nenhum teste de fraude (corpo com pontos, prazo vencido, finish duplicado, farm de questão própria) altera o ledger além do previsto.
- **SC-005**: O painel funciona em 375 px sem rolagem horizontal, com o ranking abaixo do conteúdo.
- **SC-006**: Um usuário com opt-out não aparece em nenhuma resposta de `GET /api/ranking` de outro usuário.

## Fora de escopo

- Ranking por turma/instituição com convite (Fase 3, "turmas").
- Conquistas/badges e metas semanais (Fase 3).
- Exportar estatísticas (CSV/PDF).
- Ligas/temporadas com reset de pontos.

## Pontos em aberto

1. `[PRECISA ESCLARECER: o ranking deve ser global (todos os cursos) ou, por padrão, filtrado pela Área principal do estudante (ex.: só Medicina)?]` Proposta: padrão = Área principal do perfil, com opção "Todas".
2. `[PRECISA ESCLARECER: o nome exibido no ranking é o nome do Google ou um apelido escolhido no perfil?]` Proposta: apelido opcional, com fallback para primeiro nome + inicial.
3. `[PRECISA ESCLARECER: a correção posterior por checklist deve contar para o ranking da semana em que foi feita (padrão) ou da semana do simulado?]`
4. `[PRECISA ESCLARECER: mínimo de respostas para exibir a nota de desempenho — 10 (proposta) ou outro valor?]`
