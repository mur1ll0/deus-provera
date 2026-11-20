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
| 201 | Agente externo: job criado | `{ "id": "uuid", "status": "revisao" }`. **Hoje a rota devolve a linha inteira de `import_job`; padronizar para este formato** |
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
- *(Planejado)* `GET /api/imports?status=processando` lista os jobs retomáveis do usuário.

---

## `POST /api/imports/:id/commit` — gravar a revisão

> **Estado atual: `501 Não implementado (fase 1)`.** Abaixo, o contrato-alvo (tarefa T024).

### Corpo

```json
{
  "visibility": "publica",
  "cards": [
    { "area": "Medicina", "disciplina": "Ginecologia", "assunto": "Prolapso genital", "descricao": "POP-Q e tratamento",
      "questionIds": ["b1-1", "b2-2"] }
  ],
  "drafts": {
    "b1-1": { "tipo": "discursiva", "caso_id": "Q0", "contexto": "…", "enunciado": "…", "resposta_esperada": "…",
              "pontos_chave": ["…"], "alternativas": null, "dificuldade": "media", "tem_imagem": true,
              "descricao_imagem": "…", "visibility": "privada" }
  }
}
```

Regras no servidor:
1. Revalidar cada rascunho contra o contrato v2 (área/disciplina vêm do card) e reaplicar `inspectText` em todos os campos de texto.
2. Rejeitar o commit inteiro (**400**, com lista de erros por `questionId`) se houver item inválido. *(Alternativa em aberto na spec: "salvar só as válidas".)*
3. Em um único `db.batch`: findOrCreate de `area`/`discipline` por slug (`slugify`), um `question_group` por card, um `question_case` por `caso_id` distinto (com `contexto`), `question` com `case_order` pela ordem dos subitens, `content_hash` e `alternative` com `position`.
4. Deduplicar por `(owner_id, content_hash)`. Duplicatas são ignoradas e contadas.
5. Gravar `commit_result` e `status = concluida` no job.

### Respostas

| Código | Quando | Corpo |
|---|---|---|
| 200 | Gravado | `{ "saved": 139, "duplicates": 2, "groups": [{ "id": "uuid", "area": "Medicina", "disciplina": "Ginecologia", "assunto": "Prolapso genital", "count": 35 }] }` |
| 200 | Commit repetido (job `concluida`) | O mesmo `commit_result` anterior (**idempotente**) |
| 400 | Validação | `{ "error": "3 questões inválidas", "items": [{ "questionId": "b7-9", "path": "resposta_esperada", "message": "…" }] }` |
| 401 / 404 | | |
| 409 | Job ainda em `processando` | `{ "error": "Importação ainda em processamento." }` |
| 413 | Corpo > 4,5 MB | O cliente envia em partes (`?part=1&of=3`, planejado) |
| 501 | Implementação atual | `{ "error": "Não implementado (fase 1)." }` |

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
