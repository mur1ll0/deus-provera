# Contrato: formato de importação v2 (`"versao": "2.0"`)

Fonte da verdade em código: [`shared/schemas/import.ts`](../../../shared/schemas/import.ts) (zod). Testes: `shared/__tests__/import-and-segmenter.test.ts`.
Substitui o v1 (uma entrada por subitem com `contexto`/`caso_id`), que **não é mais aceito** — o validador responde com a mensagem "Use \"versao\": \"2.0\"…".

## Modelo

**Questão = ENUNCIADO + 1..N PERGUNTAS.** Cada pergunta tem a sua resposta: discursiva (`resposta_esperada` + `pontos_chave`) e/ou múltipla escolha (`alternativas`).

- Questão com subitens (a, b, c… / 1, 2, 3…): o texto comum vai em `enunciado`; cada subitem é um item de `perguntas`.
- Questão sem subitens: tudo (inclusive o comando "Qual a conduta?") vai em `enunciado`; `perguntas` tem **um** item com `texto: ""` (pergunta única).

## Raiz

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `versao` | `"2.0"` | sim | literal |
| `origem.arquivo` | string ≤ 200 | não | nome do PDF |
| `origem.observacoes` | string ≤ 2000 | não | resumo do que o agente aproveitou do material (ex.: "Assuntos conforme o índice da p. 2") — FR-R5 |
| `questoes` | array | sim | 1 a 300 |

## Questão

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `area` | string 1–80 | sim | ex.: Medicina |
| `disciplina` | string 1–80 | sim | ex.: Ginecologia |
| `assunto` | string | não | **amplo e repetido** entre questões do mesmo tema; se o material nomeia o tema (índice, título de seção), usar esse nome com a mesma grafia (FR-R5); > 80 caracteres é truncado com "…" (não rejeita) |
| `rotulo` | string | não | rótulo original ("QUESTÃO 8"); > 40 caracteres é truncado |
| `enunciado` | string 1–12000 | sim | caso clínico / texto-base / comando |
| `perguntas` | array | sim | 1 a 12; se houver mais de 1, **todas** precisam de `texto` |
| `dificuldade` | `facil`\|`media`\|`dificil` | não | padrão `media` |
| `tem_imagem` | boolean | não | dados de imagem devem estar transcritos no enunciado |
| `descricao_imagem` | string ≤ 2000 | não | |
| `pagina` | inteiro > 0 | não | página onde a questão começa |

## Pergunta

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `rotulo` | string ≤ 10 | não | "a", "b", "1"… (nulo na pergunta única) |
| `texto` | string ≤ 3000 | não (padrão `""`) | inclui complementos como "Justifique." |
| `tipo` | `objetiva`\|`discursiva` | sim | tipo **original** da resposta no material |
| `resposta_esperada` | string ≤ 12000 | se `discursiva` | literal do material; na `objetiva`, opcional (o agente externo a escreve a partir da alternativa correta e do comentário — FR-R7), e permite usar a pergunta em simulado discursivo |
| `pontos_chave` | string[] (≤ 15, cada ≤ 300) | não | pontos de acerto para correção |
| `alternativas` | array (≤ 8) | se `objetiva` | se presente (em qualquer tipo): ≥ 2 e **exatamente 1** `correta: true` |

### Alternativa

| Campo | Tipo | Obrigatório |
|---|---|---|
| `texto` | string 1–1500 | sim |
| `correta` | boolean | sim |
| `explicacao` | string | não |
| `gerada_por_ia` | boolean | não |

## Tabelas, POP-Q, gráficos e fórmulas no texto

`enunciado`, `perguntas[].texto` e `resposta_esperada` são texto puro, mas podem conter **tabelas Markdown** (linhas seguidas que começam e terminam com `|`, separadas por `\n`). A tela desenha a tabela (`shared/rich-text.ts` + `src/components/RichText.tsx`); sem tela, o texto continua legível. Não há HTML.

- Linha `|---|---|` logo após a 1ª linha → a 1ª linha é cabeçalho. Sem ela, todas as linhas são corpo (útil para a grade POP-Q).
- `**texto**` ocupando a célula inteira → célula em destaque (rótulo).
- Uma linha isolada com `|` continua sendo texto.
- POP-Q: grade 3 × 3 do original em 6 linhas (`| **Aa** | **Ba** | **C** |`, valores, `| **HG** | **CP** | **CVT** |`, valores, `| **Ap** | **Bp** | **D** |`, valores).
- Gráfico: valores lidos em tabela no texto + descrição em `descricao_imagem`. Fórmula: uma linha com símbolos Unicode (sem LaTeX).

## Tolerâncias do leitor (`parseImportText`)

- Aceita JSON puro **ou** dentro de blocos ` ```json … ``` ` (resposta típica de chatbot).
- **Vários blocos** (resposta em "Parte 1/3, 2/3…") são unidos em um único arquivo.
- Até 50 erros são devolvidos, cada um com o caminho (`questoes.3.perguntas.1.alternativas`).

## Exemplo (III UNIDADE.pdf, QUESTÃO 8)

```json
{
  "versao": "2.0",
  "origem": { "arquivo": "III UNIDADE.pdf" },
  "questoes": [
    {
      "area": "Medicina",
      "disciplina": "Ginecologia",
      "assunto": "HPV e lesões precursoras",
      "rotulo": "QUESTÃO 8",
      "enunciado": "Joana tem 45 anos e menstrua regularmente. (…) A colpocitologia mostrou ASCUS. Responda:",
      "perguntas": [
        {
          "rotulo": "a",
          "texto": "A paciente apresenta um quadro clínico de patologia causada pelo HPV (…) há necessidade de solicitar algum outro exame? Justifique.",
          "tipo": "discursiva",
          "resposta_esperada": "Sim, há necessidade de solicitar outro exame, principalmente o teste de DNA do HPV de alto risco (…)",
          "pontos_chave": ["Solicitar teste de DNA-HPV de alto risco", "Transmissão não depende de penetração", "Aos 45 anos o objetivo é avaliar persistência"],
          "alternativas": [
            { "texto": "Sim: DNA-HPV de alto risco, pois a transmissão independe de penetração", "correta": true, "gerada_por_ia": true },
            { "texto": "Não: sem penetração não há risco de HPV", "correta": false, "gerada_por_ia": true, "explicacao": "O HPV é transmitido por contato pele/mucosa." }
          ]
        },
        {
          "rotulo": "b",
          "texto": "(…) Elas perguntam: o que significa este resultado? O que deve ser feito agora?",
          "tipo": "discursiva",
          "resposta_esperada": "O achado de epitélio acetobranco denso com borda bem delimitada é uma alteração de grau maior (…)",
          "pontos_chave": ["Achado colposcópico de grau maior", "Sugere HSIL (NIC II/III)", "Biópsia dirigida / ver e tratar"]
        }
      ],
      "dificuldade": "media",
      "pagina": 7
    }
  ]
}
```

## Erros típicos

| Entrada | Erro |
|---|---|
| `"versao": "1.0"` | `versao`: Use "versao": "2.0" (formato com enunciado + perguntas)… |
| pergunta objetiva com 2 corretas | `questoes.0.perguntas.1.alternativas`: As alternativas precisam ter exatamente 1 correta (encontradas: 2). |
| discursiva sem resposta | `questoes.0.perguntas.0.resposta_esperada`: Pergunta discursiva precisa de resposta esperada. |
| 2 perguntas, uma sem texto | `questoes.0.perguntas`: Com mais de uma pergunta, todas precisam de texto. |
