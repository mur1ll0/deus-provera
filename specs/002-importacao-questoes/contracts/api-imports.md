# Contrato — API de importação (`/api/imports`)

**Implementação**: `server/routes/imports.ts` (Hono, montado em `server/app.ts`). Todas as rotas exigem sessão (`requireUser`, spec 001).

Convenções:
- JSON UTF-8 em requisição e resposta. Erros sempre no formato `{ "error": string }` (`app.onError`).
- Ids de job são UUID. Um usuário só enxerga os próprios jobs (filtro por `owner_id`). Job de outro usuário responde **404**, não 403.
- Limites da plataforma: **corpo ≤ 4,5 MB** (acima disso a Vercel responde 413 antes de chegar à função) e **função ≤ 300 s** (`vercel.json` › `maxDuration`).

## Status do job

```
rascunho ─► processando ─► revisao ─► concluida
                 │   ▲
                 │   └── (429: pausa; checkpoint mantido; /run retoma)
                 └─────► falhou        cancelada (planejado: DELETE)
```

| Status | Significado |
|---|---|
| `processando` | Grafo em execução, retomável por `/run` |
| `revisao` | Rascunhos e cards prontos para a tela de revisão |
| `concluida` | Commit realizado (`commit_result` gravado) |
| `falhou` | Erro não recuperável. `error` descreve. O checkpoint fica salvo |
| `cancelada` | Cancelado pelo usuário (planejado) |
| `rascunho` | Reservado (job criado sem processamento; não usado na v1) |

---

## `POST /api/imports` — criar job

### Corpo — PDF com IA

```json
{
  "source": "pdf_ia",
  "fileName": "Unidade II.pdf",
  "generateDistractors": false,
  "visibility": "publica",
  "pages": [
    { "page": 1, "text": "PROLAPSO GENITAL\nQUESTÕES GINECOLOGIA II UNIDADE…" },
    { "page": 2, "text": "QUESTÃO 1. Observe abaixo os esquemas…\n[[imagem p2-1]]\nA) Prolapso…" }
  ],
  "images": [{ "id": "p2-1", "page": 2 }]
}
```

| Campo | Regras |
|---|---|
| `source` | `"pdf_ia"` |
| `fileName` | ≤ 200 caracteres |
| `generateDistractors` | boolean, padrão `false` |
| `visibility` | `"privada"` \| `"publica"`. **Planejado** (T025); hoje não é aceito |
| `pages` | 1–400 itens; `page` inteiro > 0; `text` ≤ 60.000 caracteres (texto extraído no navegador; o PDF nunca é enviado). Pode conter `[[imagem pN-k]]` na posição de cada imagem útil (`src/features/import/pdfExtract.ts` › `markedText`) |
| `images` | Manifesto das imagens que o cliente vai enviar em `/images` (≤ 300; `id` = `p<página>-<ordem>`). Ids sem marcador no texto são ignorados. Padrão `[]` (sem visão: os marcadores viram `[Imagem p. N]`) |

Resposta 201 do PDF: `{ "id", "status": "processando", "images": <nº de imagens pendentes> }`.

### Corpo — agente externo

```json
{ "source": "agente_externo", "payload": { "versao": "1.0", "questoes": [ … ] } }
```

`payload` é validado contra o [contrato v2](./import-format-v2.md). Não consome IA: o job nasce em `revisao`.

### Respostas

| Código | Quando | Corpo |
|---|---|---|
| 201 | PDF: job criado | `{ "id": "uuid", "status": "processando" }` |
| 201 | Agente externo ou lote manual (`{ "source": "manual", "fileName"? }`): job criado em revisão | `{ "id": "uuid", "status": "revisao" }` |
| 400 | Corpo inválido | `{ "error": "<primeira mensagem de validação>" }` |
| 401 | Sem sessão | `{ "error": "Faça login para continuar." }` |
| 413 | Corpo > 4,5 MB (Vercel) | Página de erro da plataforma (`FUNCTION_PAYLOAD_TOO_LARGE`). O cliente deve evitar, dividindo em vários jobs |

**Idempotência**: a criação não é idempotente. O cliente evita duplo envio desabilitando o botão. *(Planejado: cabeçalho `Idempotency-Key` com o hash do texto, retornando o job existente por 10 min.)*

---

## `POST /api/imports/:id/images` — transcrever imagens das páginas (visão)

O PDF não sai do navegador, então o cliente renderiza o **recorte** de cada imagem útil em JPEG (`src/features/import/pageImages.ts`: lado maior ~1400 px, qualidade 0,75, ~40–100 KB) e envia em lotes **antes** de chamar `/run`. Cada requisição = **1 chamada** à cadeia `vision` (modelos `:free`) e conta no orçamento diário. Os recortes **não são guardados**: só a transcrição, em `import_job.state.images`.

```json
{ "images": [{ "id": "p2-1", "data": "/9j/4AAQSkZJRgABAQ…" }, { "id": "p3-1", "data": "…" }] }
```

| Campo | Regras |
|---|---|
| `images` | 1–3 itens (`VISION_BATCH`) |
| `id` | Precisa estar no manifesto do job e não estar `ok` |
| `data` | JPEG ou PNG em base64 **sem** `data:` (assinatura conferida), ≤ 1,5 MB de base64 cada; o lote fica < 4,5 MB |

| Código | Quando | Corpo |
|---|---|---|
| 200 | Lote processado (mesmo que a IA falhe) | `{ "results": [{ "id", "status": "ok" \| "falhou", "kind": "texto" \| "pop_q" \| "tabela" \| "figura" \| "decorativa" \| null, "retry": boolean }], "warnings": [], "pending": n }` |
| 400 | Corpo inválido, imagem fora do manifesto, não JPEG/PNG | `{ "error" }` |
| 401 / 404 | | |
| 409 | Job já passou da segmentação (ou não está `processando`) | `{ "error": "As imagens só podem ser enviadas antes da segmentação…" }` |
| 429 | Orçamento de IA esgotado | Nada é gravado; o cliente pode reenviar depois ou seguir sem visão |

`retry: true` = 1ª falha daquela imagem: o cliente a reenvia **sozinha** no fim da fila (`uploadPageImages`). Na 2ª falha ela fica `falhou`; ao rodar `/run`, imagens não transcritas viram `[Imagem p. N]` na questão (sinalizada para revisão). A transcrição passa pelo guardrail (`inspectText`) antes de ser gravada.

---

## `POST /api/imports/:id/run` — avançar o pipeline

Executa nós do grafo (`guard → vision* → segment → structure* → classify → [plan-distractors → distractors*] → validate`) até terminar ou até o prazo interno: **240 s** de orçamento, sem iniciar novo nó a menos de 60 s do fim. O checkpoint é gravado em `import_job.state` após **cada nó**.

Corpo: vazio.

| Código | Quando | Corpo |
|---|---|---|
| 200 | Avançou ou terminou | `{ "id", "status": "processando" \| "revisao", "node": "<próximo nó>", "history": [{ "node", "ok", "ms", "note?" }], "progress": { "blocks", "pendingBatches" } }` (history: últimos 5) |
| 200 | Job não está em `processando` | `{ "id", "status" }` (nada é executado) |
| 401 | Sem sessão | |
| 404 | Job inexistente ou de outro usuário | |
| 429 | Orçamento de IA esgotado (global `AI_DAILY_BUDGET` ou por usuário `AI_USER_DAILY_LIMIT`) | `{ "error": "Cota diária de IA do sistema atingida. Tente amanhã ou use o modo \"agente externo\"." }`. Checkpoint mantido, status continua `processando` |
| 500 | Erro não recuperável | `{ "error": "Falha no processamento. Seu progresso foi salvo." }`. Status vira `falhou` |

Falhas de **modelo** (rate limit do OpenRouter, JSON inválido, grounding reprovado, indisponibilidade) **não** geram erro HTTP. Elas são absorvidas pelo fallback em 3 camadas e, no limite, pelo rascunho determinístico com flag "Processado sem IA — revise".

**Idempotência e concorrência**: chamar `/run` de novo continua do último checkpoint, e nós concluídos não são refeitos. Duas chamadas **simultâneas** ao mesmo job poderiam processar o mesmo lote duas vezes. A implementação DEVE adotar uma *lease*: `UPDATE … SET run_lease_until = now() + 270s WHERE id = $1 AND (run_lease_until IS NULL OR run_lease_until < now())`. Se nenhuma linha for afetada, responder **409** `{ "error": "Processamento já em andamento." }`. **Planejado; hoje não há lease.**

### Fluxo do cliente (implementado)

`src/features/import/importJob.ts` (sem React; testado de ponta a ponta contra a rota real em `src/features/import/__tests__/importJob.test.ts`) e o hook `useImportJob.ts`:

1. `POST /api/imports` com `pdfJobPayload(pdf, { vision })` → guarda o id no navegador (`localStorage`) para retomar.
2. Visão (se marcada e houver imagens): `renderPageImages()` → `uploadPageImages()` em lotes ≤ 3; `retry: true` volta sozinha no fim da fila; **429 aqui não para o fluxo** (as imagens restantes viram `[Imagem p. N]`).
3. `POST /:id/run` em loop até `revisao` (máx. 60 chamadas). Enquanto cada `/run` roda (até ~240 s), `GET /:id` a cada 4 s atualiza o nó e os lotes restantes na tela.
4. `GET /:id` → `draftsFromServerJob()` → tela de revisão.

Erros: 429 → "Importação pausada" com **Tentar continuar** (mesmo job, do checkpoint) e **Usar meu agente de IA**; rede/servidor → **Tentar continuar**; sair da tela interrompe só o acompanhamento — ao voltar, um aviso oferece **Continuar** o job salvo. Na retomada não há PDF, então imagens ainda não enviadas viram `[Imagem p. N]`. *(Planejado: 409 de lease → acompanhar via GET.)*

---

## `GET /api/imports/:id` — estado do job

| Código | Corpo |
|---|---|
| 200 | ver abaixo |
| 401 / 404 | |

```json
{
  "id": "6f1c…",
  "status": "revisao",
  "node": "__end__",
  "progress": { "blocks": 141, "pendingBatches": 0, "images": { "ok": 44, "falhou": 2 } },
  "warnings": ["Página 12: conteúdo suspeito removido (tentativa_de_instrucao)"],
  "cards": [
    { "area": "Medicina", "disciplina": "Ginecologia", "assunto": "Prolapso genital", "descricao": "…", "questionIds": ["b1-1", "b2-2"] }
  ],
  "drafts": {
    "b1-1": { "id": "b1-1", "blockId": "b1", "area": "Medicina", "disciplina": "Ginecologia", "assunto": "Prolapso genital",
              "tipo": "discursiva", "caso_id": "Q0", "contexto": null, "enunciado": "a) dê o diagnóstico (estádio)…",
              "resposta_esperada": "…", "pontos_chave": ["…"], "dificuldade": "media", "tem_imagem": true,
              "pagina": 1, "resumo": "…", "flags": [] }
  },
  "payload": null
}
```

- `cards` e `drafts` só vêm em `revisao`. Cada rascunho segue o [contrato v2](./import-format-v2.md) + `id`, `blockId`, `resumo`, `flags`.
- Para jobs de agente externo, `payload` traz o JSON v2 validado, e a conversão para cards é feita no cliente (`draftsFromImportFile`). *(Planejado: o servidor devolver `cards`/`drafts` também nesse caso, unificando o formato.)*
- `GET /api/imports` lista os jobs do usuário (ver abaixo).

---

## `POST /api/imports/:id/commit` — gravar a revisão

Implementado em [`server/services/import-commit.ts`](../../../server/services/import-commit.ts). A validação é compartilhada com o cliente em [`shared/schemas/import-commit.ts`](../../../shared/schemas/import-commit.ts), com as mesmas regras do editor e de `/api/questions`.

Todo método passa por um job:
- **PDF:** o job criado em `POST /api/imports`.
- **Agente externo:** a tela cria o job (`source: agente_externo`, JSON revalidado no servidor) ao salvar.
- **Lote manual:** a tela cria um job `{ "source": "manual" }` (nasce em `revisao`) ao salvar.

### Corpo (modelo v2: enunciado + perguntas)

```json
{
  "cards": [
    {
      "area": "Medicina", "discipline": "Ginecologia", "topic": "Prolapso genital", "description": "POP-Q e tratamento",
      "questions": [
        {
          "sourceLabel": "QUESTÃO 8",
          "stem": "Joana tem 45 anos… Responda:",
          "items": [
            { "label": "a", "prompt": "Há necessidade de outro exame?", "type": "discursiva", "expectedAnswer": "Sim, DNA-HPV.", "keyPoints": ["DNA-HPV"],
              "alternatives": [{ "text": "Sim", "correct": true, "source": "ia" }, { "text": "Não", "correct": false, "source": "ia" }] }
          ],
          "difficulty": "media", "visibility": "publica", "hasImage": false, "imageDescription": null,
          "flags": ["Processado sem IA — revise"]
        }
      ]
    }
  ]
}
```

| Limite | Valor |
|---|---|
| Cards | 1–200 |
| Questões por card | 1–500 |
| Questões por importação | ≤ 1000 |
| Corpo | ≤ 4,5 MB (Vercel) |

Regras por questão: as de `questionInput` (`/api/questions`).
- Enunciado ≥ 5 caracteres.
- De 1 a 20 perguntas. Com várias perguntas, todas precisam de texto.
- Discursiva exige `expectedAnswer`.
- Objetiva exige ≥ 2 alternativas.
- Com alternativas, exatamente 1 correta, e no máximo 8.
- Os textos passam por `normalizeText`.

`visibility` vale por questão (padrão `privada`) — T025. O card "Revisar categoria" (`Sem área` / `Sem disciplina`) é recusado até o usuário escolher a classificação.

### Gravação

1. **Taxonomia:** área e disciplina por **slug**, criadas se não existirem (globais, idempotente).
2. **Card:** reaproveita o `question_group` do dono com a mesma Área › Disciplina · Assunto; senão cria (com `description`).
3. **Duplicatas:** por `content_hash` (enunciado + perguntas + alternativas normalizados), contra o banco do usuário (não excluídas) e dentro do lote. São puladas e contadas (SC-007).
4. **Escrita:** um único `db.batch`, inserções em fatias de 400 linhas.
   - O job vira `concluida`.
   - `state` passa a ser só `{ commitResult }`: o texto do PDF e os rascunhos saem do banco.
   - `origin` da questão = `source` do job (`pdf_ia` | `agente_externo` | `manual`).

### Respostas

| Código | Quando | Corpo |
|---|---|---|
| 200 | Gravado | `{ "saved": 139, "duplicates": 2, "groups": [{ "id": "uuid", "area": "Medicina", "discipline": "Ginecologia", "topic": "Prolapso genital", "count": 35 }] }` (só cards que receberam questões) |
| 200 | Commit repetido (job `concluida`) | O mesmo resultado anterior (**idempotente**) |
| 400 | Validação — **nada é gravado** | `{ "error": "3 itens precisam de ajuste antes de salvar.", "items": [{ "card": 0, "question": 4, "message": "Resposta: informe a resposta esperada." }, { "card": 2, "message": "Escolha a área do card \"Revisar categoria\"." }] }` (`card`/`question` = índices no corpo) |
| 401 / 404 | Sem sessão / job inexistente ou de outro usuário | |
| 409 | Job em `processando` (ou fora de `revisao`) | `{ "error": "Importação ainda em processamento." }` |
| 413 | Corpo > 4,5 MB | A tela pede para salvar em duas vezes |

**Na tela (T040, decisão):** com itens inválidos a confirmação fica bloqueada. Isso vale tanto na pré-validação local, com o mesmo schema, quanto num 400 do servidor. A revisão lista cada problema com **Editar** (questão ou card) e oferece **Tirar N questões com problema da importação**, para quem prefere salvar só as completas.

---

## `GET /api/imports` — importações recentes (T035)

`?status=processando|revisao|concluida|falhou` (opcional). Resposta: `{ "jobs": [{ "id", "source", "fileName", "status", "createdAt", "updatedAt" }] }` (até 20, mais recentes primeiro).

A tela de importação lista as **não salvas** (`processando` e `revisao`, exceto lotes manuais), com **Continuar** ou **Revisar**. Assim o resultado da IA não se perde ao recarregar a página ou trocar de dispositivo.

---

## Endpoints planejados (Fase 2)

| Método | Rota | Uso |
|---|---|---|
| `PATCH` | `/api/imports/:id/draft` | Autosave da revisão (cards + rascunhos editados) |
| `DELETE` | `/api/imports/:id` | Cancelar job (`status = cancelada`) |
| `POST` | `/api/ai/distractors` | Distratores sob demanda no editor (≤ 6 questões por chamada) |

## Orçamento de IA (referência)

| Limite | Valor | Onde |
|---|---|---|
| OpenRouter `:free` por minuto | 20 req/min | Provedor. Tratado por breaker (abre 60 s em rate limit) e `models` fallback |
| OpenRouter `:free` por dia | 50 sem créditos · **1000 com compra única de US$10** | Provedor |
| Orçamento global do app | `AI_DAILY_BUDGET` (padrão 900) | `server/middleware.ts` › `reserveAiRequest` |
| Limite por usuário | `AI_USER_DAILY_LIMIT` (padrão 60) | idem |
| Custo típico | ~1 req por lote de 3 questões + 1 por lote de 3 imagens (+1 por imagem que falhar) + 1 classificação/40 + 1 distratores/6 | `server/ai/pipelines/import-graph.ts`, `server/ai/pipelines/vision.ts` |

> O orçamento conta linhas de `ai_call` do dia, mas **hoje nenhuma rota grava `ai_call`** (tarefa T015). Até isso ser feito, o limite não decrementa.
