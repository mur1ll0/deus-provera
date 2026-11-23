import { randomUUID } from 'node:crypto'
import { and, desc, eq, notInArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { normalizeDocuments } from '../../shared/answer-key'
import { IMAGE_MARK_RE } from '../../shared/page-images'
import { importFileSchema } from '../../shared/schemas/import'
import { commitIssues, importCommitInput } from '../../shared/schemas/import-commit'
import { applyImageResults, importGraph, type ImportState, type PageImageState } from '../ai/pipelines/import-graph'
import { describeImageBatch, MAX_IMAGE_BASE64, VISION_BATCH } from '../ai/pipelines/vision'
import { END } from '../ai/graph'
import { db, schema } from '../db/client'
import { requireUser, reserveAiRequest, type AppEnv } from '../middleware'
import { commitImport } from '../services/import-commit'
import { AiQuotaExhaustedError } from '../ai/client'
import { loadTaxonomyForPrompt } from '../services/taxonomy'

/**
 * Importação de questões.
 *  POST /imports             cria job (texto extraído no navegador OU JSON do agente externo)
 *  POST /imports/:id/images  transcreve um lote (≤ 3) de recortes de imagem das páginas (visão), ANTES de /run
 *  POST /imports/:id/run     avança o grafo até ~240 s (cliente chama em loop até status "revisao")
 *  GET  /imports/:id         estado/progresso
 *  POST /imports/:id/commit  grava cards+questões revisados pelo usuário (specs/002 § Confirmação)
 *  GET  /imports             importações recentes do usuário (?status=processando → retomáveis)
 *  DELETE /imports/:id       remove uma importação não salva (status cancelada, estado apagado)
 */

const IMAGE_ID = /^p\d{1,3}-\d{1,2}$/

const createSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('pdf_ia'),
    fileName: z.string().max(200),
    generateDistractors: z.boolean().default(false),
    // Texto já extraído no navegador (pdf.js), com `[[imagem pN-k]]` na posição de cada imagem.
    // Limite bem abaixo dos 4,5 MB da Vercel.
    pages: z.array(z.object({ page: z.number().int().positive(), text: z.string().max(60_000) })).min(1).max(400),
    // Imagens das páginas que o navegador vai enviar em /images (só o manifesto; os recortes vêm depois).
    images: z
      .array(z.object({ id: z.string().regex(IMAGE_ID), page: z.number().int().positive() }))
      .max(300)
      .default([]),
    // Vários PDFs (ex.: questões + gabarito): páginas na numeração global, contínua entre os arquivos (spec 002 US6).
    documents: z
      .array(
        z.object({
          name: z.string().max(200),
          role: z.enum(['questoes', 'respostas', 'misto']),
          firstPage: z.number().int().positive(),
          lastPage: z.number().int().positive(),
        }),
      )
      .max(10)
      .optional(),
  }),
  z.object({ source: z.literal('agente_externo'), payload: importFileSchema }),
  // Lote digitado na tela (T048): nasce em revisão e é salvo pelo mesmo /commit.
  z.object({ source: z.literal('manual'), fileName: z.string().max(200).optional() }),
])

/** Rascunho da revisão (cards + rascunhos), salvo automaticamente — T042. */
const draftSchema = z.object({
  review: z.object({
    cards: z.array(z.record(z.string(), z.unknown())).max(300),
    drafts: z.record(z.string(), z.unknown()),
    source: z.enum(['pdf_ia', 'agente_externo', 'manual']),
    fileName: z.string().max(200).optional(),
  }),
})

/** Um lote de recortes JPEG/PNG (base64 sem `data:`), ≤ 3 por requisição para caber nos 4,5 MB. */
const imagesSchema = z.object({
  images: z
    .array(
      z.object({
        id: z.string().regex(IMAGE_ID),
        data: z
          .string()
          .min(100)
          .max(MAX_IMAGE_BASE64)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'imagem em base64 inválida'),
      }),
    )
    .min(1)
    .max(VISION_BATCH),
})

/** Aceita só JPEG/PNG de verdade (assinatura do arquivo), não "qualquer coisa" em base64. */
function imageMediaType(base64: string): 'image/jpeg' | 'image/png' | null {
  const head = Buffer.from(base64.slice(0, 16), 'base64')
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  return null
}

export const importsRoutes = new Hono<AppEnv>()
  .use(requireUser)

  .post('/', async (c) => {
    const user = c.get('user')!
    const body = createSchema.safeParse(await c.req.json())
    if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Requisição inválida' })

    if (body.data.source === 'agente_externo') {
      // JSON do agente externo já está estruturado: vai direto para revisão (sem custo de IA).
      const [job] = await db()
        .insert(schema.importJob)
        .values({ ownerId: user.id, source: 'agente_externo', fileName: body.data.payload.origem?.arquivo ?? null, status: 'revisao', state: { payload: body.data.payload } })
        .returning()
      return c.json({ id: job.id, status: job.status }, 201)
    }
    if (body.data.source === 'manual') {
      const [job] = await db()
        .insert(schema.importJob)
        .values({ ownerId: user.id, source: 'manual', fileName: body.data.fileName ?? null, status: 'revisao', state: {} })
        .returning()
      return c.json({ id: job.id, status: job.status }, 201)
    }

    // Só imagens cujo marcador existe no texto da página (o resto não teria onde entrar)
    const marks = new Set(body.data.pages.flatMap((p) => [...p.text.matchAll(IMAGE_MARK_RE)].map((m) => m[1])))
    const images: Record<string, PageImageState> = {}
    for (const im of body.data.images) if (marks.has(im.id)) images[im.id] = { page: im.page, status: 'pendente' }

    // Intervalos inválidos (sobrepostos/invertidos ou fora das páginas enviadas) → 400: o cliente monta errado
    const docs = body.data.documents?.length ? normalizeDocuments(body.data.documents) : null
    const pageSet = new Set(body.data.pages.map((p) => p.page))
    if (body.data.documents?.length && (!docs || docs.some((d) => ![...pageSet].some((p) => p >= d.firstPage && p <= d.lastPage)))) {
      return c.json({ error: 'Documentos com páginas inválidas (sobrepostas ou fora do texto enviado).' }, 400)
    }

    const state = importGraph.initial({
      nonce: randomUUID().slice(0, 8),
      options: { generateDistractors: body.data.generateDistractors },
      rawPages: body.data.pages,
      ...(docs ? { docs } : {}),
      images,
      blocks: [],
      pendingBatches: [],
      pendingDistractors: [],
      drafts: {},
      cards: [],
      warnings: [],
      aiLog: [],
      guardRisk: 'baixo',
    })
    const [job] = await db()
      .insert(schema.importJob)
      .values({ ownerId: user.id, source: 'pdf_ia', fileName: body.data.fileName, status: 'processando', state: state as unknown as Record<string, unknown> })
      .returning()
    return c.json({ id: job.id, status: job.status, images: Object.keys(images).length }, 201)
  })

  /*
   * Etapa de visão: o PDF nunca vem ao servidor, então o navegador renderiza o recorte de cada imagem
   * (src/features/import/pageImages.ts) e envia em lotes ≤ 3 ANTES de chamar /run. Cada lote = 1 chamada
   * à cadeia `vision` (modelos :free). Os recortes não são guardados — só a transcrição, em import_job.state.
   */
  .post('/:id/images', async (c) => {
    const user = c.get('user')!
    const body = imagesSchema.safeParse(await c.req.json())
    if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Requisição inválida' })
    const [job] = await db().select().from(schema.importJob).where(and(eq(schema.importJob.id, c.req.param('id')), eq(schema.importJob.ownerId, user.id)))
    if (!job) throw new HTTPException(404)
    const state = job.state as unknown as ImportState
    if (job.status !== 'processando' || !['guard', 'vision'].includes(state.cursor)) {
      throw new HTTPException(409, { message: 'As imagens só podem ser enviadas antes da segmentação (logo após criar a importação).' })
    }
    const known = state.images ?? {}
    const batch = body.data.images.map((im) => {
      const meta = known[im.id]
      if (!meta || meta.status === 'ok') throw new HTTPException(400, { message: `Imagem ${im.id} não está pendente nesta importação.` })
      const mediaType = imageMediaType(im.data)
      if (!mediaType) throw new HTTPException(400, { message: `Imagem ${im.id} não é JPEG/PNG.` })
      return { id: im.id, page: meta.page, base64: im.data, mediaType }
    })

    let aiRequests = job.aiRequests
    const { results, warnings } = await describeImageBatch(batch, {
      userId: user.id,
      deadline: Date.now() + 240_000, // mesmo prazo por passo de /run (função ≤ 300 s)
      reserveAiRequest: async () => {
        await reserveAiRequest(user.id) // 429 se a cota acabou: nada é gravado, o cliente pode tentar depois
        aiRequests++
      },
    })

    // Relê o estado para não sobrescrever outro lote gravado em paralelo (o cliente envia em sequência)
    const [fresh] = await db().select().from(schema.importJob).where(eq(schema.importJob.id, job.id))
    if (fresh?.status !== 'processando') throw new HTTPException(409, { message: 'Esta importação foi removida.' })
    const next = fresh.state as unknown as ImportState
    // falha → continua "pendente" até VISION_MAX_ATTEMPTS: o cliente reenvia sozinha (uploadPageImages)
    const nextImages = applyImageResults(next.images ?? {}, results, batch)
    const updated: ImportState = { ...next, images: nextImages, warnings: [...next.warnings, ...warnings] }
    await db()
      .update(schema.importJob)
      .set({ state: updated as unknown as Record<string, unknown>, aiRequests: fresh.aiRequests + (aiRequests - job.aiRequests), updatedAt: new Date() })
      .where(and(eq(schema.importJob.id, job.id), eq(schema.importJob.status, 'processando')))

    return c.json({
      results: results.map((r) => ({ id: r.id, status: r.status, kind: r.kind ?? null, retry: nextImages[r.id]?.status === 'pendente' })),
      warnings,
      pending: Object.values(nextImages).filter((v) => v.status === 'pendente').length,
    })
  })

  .post('/:id/run', async (c) => {
    const user = c.get('user')!
    const [job] = await db().select().from(schema.importJob).where(and(eq(schema.importJob.id, c.req.param('id')), eq(schema.importJob.ownerId, user.id)))
    if (!job) throw new HTTPException(404)
    if (job.status !== 'processando') return c.json({ id: job.id, status: job.status })

    const taxonomy = await loadTaxonomyForPrompt(user.id)
    const deadline = Date.now() + 240_000 // folga dentro dos 300 s do plano Hobby
    let aiRequests = job.aiRequests
    const save = (s: ImportState, status: 'processando' | 'revisao' | 'falhou' = 'processando', error?: string) =>
      db()
        .update(schema.importJob)
        .set({ state: s as unknown as Record<string, unknown>, status, aiRequests, guardrailRisk: s.guardRisk, error: error ?? null, updatedAt: new Date() })
        .where(and(eq(schema.importJob.id, job.id), eq(schema.importJob.status, 'processando'))) // removida no meio (T063) → não grava

    let state = job.state as unknown as ImportState
    try {
      state = await importGraph.runUntil(
        state,
        {
          userId: user.id,
          deadline, // a cadeia de modelos nunca passa do prazo do passo
          taxonomy,
          reserveAiRequest: async () => {
            await reserveAiRequest(user.id)
            aiRequests++
          },
        },
        {
          deadline,
          // guarda o último checkpoint: num 429 no meio do passo, é ele que fica salvo (não o estado de antes do /run)
          onCheckpoint: (s) => {
            state = s
            return save(s).then(() => undefined)
          },
        },
      )
      const done = state.cursor === END
      await save(state, done ? 'revisao' : 'processando')
      return c.json({
        id: job.id,
        status: done ? 'revisao' : 'processando',
        node: state.cursor,
        history: state.history.slice(-5),
        progress: { blocks: state.blocks?.length ?? 0, pendingBatches: state.pendingBatches?.length ?? 0 },
      })
    } catch (err) {
      if (err instanceof HTTPException && err.status === 429) {
        await save(state) // mantém checkpoint; usuário retoma depois
        throw err
      }
      // Cota diária de IA gratuita esgotada no OpenRouter: pausa (checkpoint), retoma amanhã ou usa o agente próprio
      if (err instanceof AiQuotaExhaustedError) {
        await save(state)
        throw new HTTPException(429, { message: err.message })
      }
      await save(state, 'falhou', String((err as Error).message))
      throw new HTTPException(500, { message: 'Falha no processamento. Seu progresso foi salvo.' })
    }
  })

  .get('/:id', async (c) => {
    const user = c.get('user')!
    const [job] = await db().select().from(schema.importJob).where(and(eq(schema.importJob.id, c.req.param('id')), eq(schema.importJob.ownerId, user.id)))
    if (!job) throw new HTTPException(404)
    const s = job.state as unknown as Partial<ImportState>
    return c.json({
      id: job.id,
      status: job.status,
      node: s.cursor,
      progress: {
        blocks: s.blocks?.length ?? 0,
        pendingBatches: s.pendingBatches?.length ?? 0,
        images: Object.values(s.images ?? {}).reduce((a, v) => ({ ...a, [v.status]: (a[v.status] ?? 0) + 1 }), {} as Record<string, number>),
      },
      warnings: s.warnings ?? [],
      cards: job.status === 'revisao' ? s.cards : undefined,
      /** O que o documento diz sobre a organização (instruções, temas por questão) — exibido na revisão. */
      guide: job.status === 'revisao' ? s.guide : undefined,
      /** Questões × gabarito (vários PDFs ou gabarito no fim): o que ligou e o que sobrou — exibido na revisão. */
      link: job.status === 'revisao' ? s.link : undefined,
      drafts: job.status === 'revisao' ? s.drafts : undefined,
      payload: (job.state as { payload?: unknown }).payload,
      reviewDraft: job.status === 'revisao' ? (job.state as { reviewDraft?: unknown }).reviewDraft : undefined,
    })
  })

  /*
   * Autosave da revisão (T042): guarda cards + rascunhos editados no job, para retomar depois.
   * Não valida o conteúdo a fundo — a validação completa é a do /commit. Só jobs em revisão.
   */
  .patch('/:id/draft', async (c) => {
    const user = c.get('user')!
    const body = draftSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw new HTTPException(400, { message: body.error.issues[0]?.message ?? 'Rascunho inválido.' })
    if (JSON.stringify(body.data.review).length > 3_500_000) throw new HTTPException(413, { message: 'Rascunho grande demais para salvar automaticamente.' })
    const [updated] = await db()
      .update(schema.importJob)
      .set({ state: sql`${schema.importJob.state} || jsonb_build_object('reviewDraft', ${JSON.stringify(body.data.review)}::jsonb)`, updatedAt: new Date() })
      .where(and(eq(schema.importJob.id, c.req.param('id')), eq(schema.importJob.ownerId, user.id), eq(schema.importJob.status, 'revisao')))
      .returning({ id: schema.importJob.id })
    if (!updated) throw new HTTPException(409, { message: 'Esta importação não está mais em revisão.' })
    return c.json({ ok: true, savedAt: new Date().toISOString() })
  })

  .get('/', async (c) => {
    const user = c.get('user')!
    const status = z.enum(['processando', 'revisao', 'concluida', 'falhou']).optional().catch(undefined).parse(c.req.query('status'))
    const j = schema.importJob
    const jobs = await db()
      .select({ id: j.id, source: j.source, fileName: j.fileName, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt })
      .from(j)
      .where(and(eq(j.ownerId, user.id), status ? eq(j.status, status) : undefined))
      .orderBy(desc(j.updatedAt))
      .limit(20)
    return c.json({ jobs })
  })

  /*
   * Remover uma importação não salva (T063): `status = cancelada` e o estado (texto do PDF, resultado
   * da IA, rascunho da revisão) é apagado — fica só o registro mínimo. Idempotente; já salva → 409.
   * Um /run ou /images ainda em curso não "ressuscita" o job: as gravações deles exigem `processando`.
   */
  .delete('/:id', async (c) => {
    const user = c.get('user')!
    const j = schema.importJob
    const owned = and(eq(j.id, c.req.param('id')), eq(j.ownerId, user.id))
    const [removed] = await db()
      .update(j)
      .set({ status: 'cancelada', state: {}, error: null, updatedAt: new Date() })
      .where(and(owned, notInArray(j.status, ['concluida', 'cancelada'])))
      .returning({ id: j.id })
    if (removed) return c.json({ ok: true })
    const [job] = await db().select({ status: j.status }).from(j).where(owned)
    if (!job) throw new HTTPException(404)
    if (job.status === 'concluida') throw new HTTPException(409, { message: 'Esta importação já foi salva no seu banco.' })
    return c.json({ ok: true }) // já removida
  })

  /*
   * Commit (T024): grava a revisão no banco. Valida tudo antes (mesmas regras do editor) e responde
   * 400 com a lista de problemas por card/questão — nada é gravado se houver item inválido.
   */
  .post('/:id/commit', async (c) => {
    const user = c.get('user')!
    const parsed = importCommitInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      const items = commitIssues(parsed.error)
      const bad = new Set(items.map((i) => `${i.card}|${i.question ?? ''}`)).size
      return c.json({ error: bad > 1 ? `${bad} itens precisam de ajuste antes de salvar.` : (items[0]?.message ?? 'Dados inválidos.'), items }, 400)
    }
    return c.json(await commitImport(user.id, c.req.param('id'), parsed.data))
  })
