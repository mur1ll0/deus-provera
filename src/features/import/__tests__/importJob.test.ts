import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedPdf } from '../pdfExtract'
import type { PageImageCrop } from '../pageImages'

/**
 * Fluxo da importação de PDF com visão (spec 002 T031/T060) de ponta a ponta, SEM rede:
 * cliente real (importJob.ts) → rota Hono real (server/routes/imports.ts) → grafo real (import-graph.ts).
 * Simulados só o banco (Map em memória, JSON como no jsonb), a sessão e as chamadas aos modelos:
 * visão devolve um quadro POP-Q (e falha 1x numa imagem para exercitar a 2ª tentativa);
 * estruturação/classificação ficam "indisponíveis" → fallback determinístico (nenhuma questão se perde).
 */

const h = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  visionCalls: [] as string[][],
  failOnce: new Set<string>(),
  quota: { images: false, run: false },
}))

vi.mock('../../../../server/db/client', async () => {
  const schema = await import('../../../../server/db/schema')
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  const last = () => [...h.rows.values()].at(-1)
  const db = () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `job-${h.rows.size + 1}`, aiRequests: 0, error: null, ...clone(v) }
          h.rows.set(row.id as string, row)
          return [clone(row)]
        },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => (last() ? [clone(last())] : []) }) }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => void Object.assign(last()!, clone(patch)) }) }),
  })
  return { db, schema }
})

vi.mock('../../../../server/middleware', async () => {
  const { createMiddleware } = await import('hono/factory')
  const { HTTPException: HE } = await import('hono/http-exception')
  return {
    requireUser: createMiddleware(async (c, next) => {
      c.set('user', { id: 'u1', name: 'Teste', email: 't@example.test' })
      await next()
    }),
    reserveAiRequest: async () => {
      if (h.quota.images || h.quota.run) throw new HE(429, { message: 'Cota diária de IA do sistema atingida.' })
    },
  }
})

vi.mock('../../../../server/services/taxonomy', () => ({ loadTaxonomyForPrompt: async () => 'Medicina > Ginecologia' }))

vi.mock('../../../../server/ai/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../server/ai/client')>()
  return {
    ...real,
    callStructured: vi.fn(async (call: { task: string; images?: { label: string }[] }) => {
      if (call.task !== 'vision') throw new real.AiUnavailableError(call.task as never, [])
      const ids = (call.images ?? []).map((i) => i.label.match(/imagem_id: (\S+)/)![1])
      h.visionCalls.push(ids)
      const imagens = ids
        .filter((id) => !h.failOnce.delete(id)) // some na 1ª vez → falha só dela → 2ª tentativa sozinha
        .map((id) => ({ id, tipo: 'pop_q' as const, transcricao: 'POP-Q — Aa -1; Ba + 1; C -5; HG 3,5; CP 2,5; CVT 7; Ap -2; Bp 0; D -6' }))
      return { value: { imagens, alertas: [] }, model: 'nvidia/nemotron-3.5-super-vl:free', attempts: [] }
    }),
  }
})

const { importsRoutes } = await import('../../../../server/routes/imports')
const { startPdfImport, driveImportJob, ImportJobError, pdfJobPayload } = await import('../importJob')
const { draftsFromServerJob } = await import('../drafts')

const app = new Hono().route('/api/imports', importsRoutes)
app.onError((err, c) => (err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: 'Erro interno' }, 500)))
const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), init)) as typeof fetch

const JPEG = `/9j/4AAQSkZJRg${'A'.repeat(200)}`

/** PDF já extraído (o que pdfExtract.ts produz): 2 páginas, cada uma com um quadro POP-Q em imagem. */
function fakePdf(): ExtractedPdf {
  const page = (n: number, label: string, id: string) => {
    const text = `${label}. Observe o esquema POP-Q da paciente e responda.\na. Qual o estádio?\nEstádio 2, segundo os pontos do quadro.\nb. Qual a conduta inicial?\nTratamento conservador com fisioterapia do assoalho pélvico.\n`
    return { page: n, text, markedText: text.replace('responda.\n', `responda.\n[[imagem ${id}]]\n`), chars: text.length, images: 1, imageRegions: [{ id, rect: { x: 50, y: 300, w: 400, h: 200 } }], needsOcr: false }
  }
  return { fileName: 'Unidade II.pdf', sizeBytes: 1000, file: null as unknown as File, fullText: '', pages: [page(2, 'QUESTÃO 1', 'p2-1'), page(3, 'QUESTÃO 2', 'p3-1')] }
}
const renderImages = async (pdf: ExtractedPdf, cb: (d: number, t: number) => void): Promise<PageImageCrop[]> => {
  const ids = pdf.pages.flatMap((p) => p.imageRegions.map((r) => ({ id: r.id, page: p.page })))
  cb(ids.length, ids.length)
  return ids.map((x) => ({ ...x, base64: JPEG, width: 100, height: 60 }))
}

beforeEach(() => {
  h.rows.clear()
  h.visionCalls.length = 0
  h.failOnce.clear()
  h.quota.images = h.quota.run = false
})

describe('importação de PDF com visão (cliente ↔ rota ↔ grafo)', () => {
  it('cria o job, transcreve as imagens (2ª tentativa sozinha), roda o pipeline e devolve rascunhos com o quadro na questão', async () => {
    h.failOnce.add('p3-1')
    const phases: string[] = []
    let jobId = ''
    const { view, upload } = await startPdfImport(fakePdf(), { vision: true }, (p) => phases.push(p.phase), { fetch: fetchImpl, renderImages, onJob: (id) => (jobId = id) })

    expect(jobId).toBe('job-1')
    expect(h.visionCalls).toEqual([['p2-1', 'p3-1'], ['p3-1']]) // lote de 2; a que falhou volta sozinha
    expect(upload).toMatchObject({ ok: 2, failed: 0, quotaExceeded: false })
    expect([...new Set(phases)]).toEqual(['criando', 'recortando', 'imagens', 'processando', 'revisao'])
    expect(view.status).toBe('revisao')

    const drafts = Object.values(view.drafts ?? {})
    expect(drafts).toHaveLength(2)
    for (const d of drafts) {
      expect(d.enunciado).toContain('[Imagem p.')
      expect(d.enunciado).toContain('POP-Q — Aa -1; Ba +1; C -5') // sinal normalizado no servidor
      expect(d.tem_imagem).toBe(true)
      expect(d.flags).toContain('Processado sem IA — revise') // estruturação indisponível → fallback
    }
    // a revisão do app recebe tudo (cards "Revisar categoria" porque a classificação também caiu)
    const review = draftsFromServerJob(view, 'privada', 'Unidade II.pdf')
    expect(Object.keys(review.drafts)).toHaveLength(2)
    expect(review.cards.flatMap((c) => c.questionIds)).toHaveLength(2)
    expect(Object.values(review.drafts).every((d) => d.hasImage && d.imageDescription?.includes('POP-Q'))).toBe(true)
  })

  it('sem visão: manifesto vazio e marcadores viram "[Imagem p. N]" (questão não se perde)', async () => {
    expect(pdfJobPayload(fakePdf(), { vision: false }).images).toEqual([])
    const { view, upload } = await startPdfImport(fakePdf(), { vision: false }, () => undefined, { fetch: fetchImpl, renderImages })
    expect(upload).toBeNull()
    expect(h.visionCalls).toHaveLength(0)
    expect(Object.values(view.drafts ?? {}).every((d) => !d.enunciado.includes('[Imagem'))).toBe(true)
  })

  it('cota esgotada na visão segue sem visão; cota em /run pausa e dá para retomar', async () => {
    h.quota.images = true
    let jobId = ''
    const err = await startPdfImport(fakePdf(), { vision: true }, () => undefined, { fetch: fetchImpl, renderImages, onJob: (id) => (jobId = id) }).catch((e: unknown) => e)
    // 429 nas imagens não derruba o fluxo, mas o /run seguinte também bate na cota → pausa retomável
    expect(err).toBeInstanceOf(ImportJobError)
    expect((err as InstanceType<typeof ImportJobError>).kind).toBe('cota')
    expect((err as InstanceType<typeof ImportJobError>).jobId).toBe(jobId)

    h.quota.images = false // "amanhã": a cota renovou
    const view = await driveImportJob(jobId, () => undefined, { fetch: fetchImpl })
    expect(view.status).toBe('revisao')
    // imagens que não chegaram ficam marcadas na questão para revisão
    expect(Object.values(view.drafts ?? {}).every((d) => d.enunciado.includes('[Imagem p.') && d.descricao_imagem?.includes('imagem não transcrita'))).toBe(true)
    const review = draftsFromServerJob(view, 'privada')
    expect(Object.values(review.drafts).every((d) => d.flags?.includes('Imagem não transcrita — confira no PDF'))).toBe(true)
  })

  it('imagens só antes da segmentação (409) e só JPEG/PNG (400)', async () => {
    const { view } = await startPdfImport(fakePdf(), { vision: false }, () => undefined, { fetch: fetchImpl, renderImages })
    const late = await fetchImpl(`/api/imports/${view.id}/images`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images: [{ id: 'p2-1', data: JPEG }] }) })
    expect(late.status).toBe(409)

    h.rows.clear()
    const created = await fetchImpl('/api/imports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pdfJobPayload(fakePdf())) })
    const { id } = (await created.json()) as { id: string }
    const notJpeg = await fetchImpl(`/api/imports/${id}/images`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images: [{ id: 'p2-1', data: 'B'.repeat(200) }] }) })
    expect(notJpeg.status).toBe(400)
  })
})
