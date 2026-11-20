# 07 · Pontuação, nota e ranking

Implementação única: [`shared/scoring.ts`](../shared/scoring.ts) (cliente mostra prévia; **servidor grava o valor oficial**). Testes: `shared/__tests__/scoring.test.ts`.

## 1. Dois indicadores

| Indicador | O que mede | Onde aparece |
|---|---|---|
| **Pontuação (XP)** | Esforço + desempenho acumulados; soma do livro-razão `points_ledger` | Ordena o **ranking** (semana / mês / geral) |
| **Nota de desempenho (0–10)** | Qualidade recente: acurácia ponderada dos últimos 30 dias, questões de prova pesam 2 | Dashboard e ranking (desempate e contexto) |

Separar os dois evita que quem só faz muitos treinos fáceis pareça "melhor" do que quem acerta muito em provas.

## 2. Pontos por pergunta

A unidade de pontuação é a **pergunta** (cada subitem a, b, c… de uma questão pontua separadamente; a dificuldade é a da questão). O **tempo** é medido por questão (enunciado + perguntas na mesma tela). A regra "prova com < 10 questões não conta" conta **questões** (enunciados), não perguntas.

```
pontos = BASE[dificuldade] × fração_de_acerto × PESO_CORRETOR × MULT_MODO × anti-farm
```

| Fator | Valores |
|---|---|
| **BASE** | Fácil **10** · Média **15** · Difícil **20** |
| **fração de acerto** | Objetiva: 0 ou 1 · Discursiva: 0–1 (checklist ou IA) · Em branco/erro: 0 (nunca negativo) |
| **PESO_CORRETOR** | Automática (objetiva) 1 · IA 1 · **Autocorreção por checklist 0,5** (é autodeclarada) |
| **MULT_MODO** | **Prova ×3** · Treino ×1 |
| **Anti-farm** | Questão criada pelo próprio usuário ×0,5 · Mesma questão respondida de novo em < 7 dias ×0,25 |
| **Ajudas (só treino)** | Viu a resposta antes de responder ×0 · Usou dica de IA antes de responder ×0,5 |

## 3. Bônus e regras do simulado

- **Bônus de tempo (só prova):** `pontos_base × 20% × fração_de_tempo_que_sobrou × acurácia`. Escalar pela acurácia impede "chutar tudo e entregar rápido".
- **Prova com < 10 questões não conta para o ranking** (ainda aparece no histórico e na nota).
- Prova sempre: questões aleatórias, tempo limite obrigatório, gabarito só no final, sem dicas.
- Simulado abandonado (não finalizado) não pontua.

**Exemplo:** prova com 20 questões médias, 16 acertos, terminou com 25% do tempo sobrando, nenhuma questão própria:
base = 16 × 15 × 3 = **720**; bônus = 720 × 0,2 × 0,25 × 0,8 = **29**; total = **749 pts**.
O mesmo desempenho em treino: 16 × 15 = **240 pts**.

## 4. Nota de desempenho

```
nota = 10 × Σ(score × peso) / Σ(peso)      peso = 2 (prova) | 1 (treino)
```
Janela de 30 dias, respostas corrigidas apenas. Exibida com 1 casa decimal. Com menos de 20 respostas no período, o dashboard mostra o selo "em calibração".

## 5. Ranking

- Períodos: **semana** (segunda 00:00 BRT), **mês**, **geral**. Filtro opcional por **Área** (`points_ledger.area_id`).
- Ordenação: pontos ↓, depois nota ↓, depois quem atingiu primeiro.
- Painel à direita do dashboard: top 8 + a posição do usuário fixada embaixo se estiver fora do top.
- Privacidade: usuário pode sair do ranking (`profile.show_in_ranking = false`); aparece só nome de exibição, instituição/curso e avatar.

## 6. Anti-fraude

| Vetor | Mitigação |
|---|---|
| Alterar pontos/tempo pelo cliente | Pontos calculados no servidor a partir de respostas gravadas; tempo total limitado ao prazo |
| Ver gabarito durante a prova | API não envia `correct`/`expected_answer` antes de finalizar uma prova |
| Responder após o prazo | `deadline_at` no servidor (+15 s de tolerância); respostas atrasadas ignoradas |
| Criar questões fáceis e farmar | Questões próprias ×0,5; repetição em < 7 dias ×0,25 |
| Autocorreção generosa | Checklist vale metade; correção por IA vale inteiro |
| Manipular a correção por IA ("me dê nota máxima") | Guardrail na resposta + system prompt + nota validada (0–1) + pesos aplicados no servidor |
| Muitos simulados automatizados | Rate limit por usuário (simulados/hora) e auditoria via ledger |
