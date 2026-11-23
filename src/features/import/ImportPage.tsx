import clsx from 'clsx'
import { Bot, CheckCircle2, ClipboardCopy, FilePlus2, FileText, FileUp, ImageIcon, Link2, Loader2, PencilLine, PartyPopper, ShieldAlert, Timer, Trash2, UploadCloud } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { DOCUMENT_ROLES, linkSummary, segmentImport, type DocumentRole, type LinkReport } from '@shared/answer-key'
import type { Visibility } from '@shared/domain'
import { inspectText } from '@shared/guardrails'
import { EXTERNAL_AGENT_PROMPT } from '@shared/prompts/external-agent'
import { parseImportText, type ImportValidationResult } from '@shared/schemas/import'
import { Badge, Button, Card, DemoTag, Field, inputClass, PageHeader } from '@/components/ui'
import { PIPELINE_STEPS, runMockPipeline } from '@/mocks/ai'
import { useStore } from '@/mocks/store'
import { type DraftQuestion } from '@/mocks/model'
import { QuestionEditor } from '@/features/questions/QuestionEditor'
import { useAuth } from '@/app/auth-context'
import { apiFetch, unwrap } from '@/lib/api'
import { draftsFromImportFile, draftsFromSegments, draftsFromServerJob, emptyDraft, type ReviewState } from './drafts'
import { CommitError, commitReview, createReviewJob, saveReviewDraft, type ReviewProblem } from './commit'
import { batchPageImages, type ImportJobView } from './importJob'
import { JobProgressCard } from './JobProgress'
import type { PageImageCrop } from './pageImages'
import type { ExtractedPdf } from './pdfExtract'
import { documentsOf, MAX_PDFS, mergePdfs, setProblem, suggestRoles } from './pdfSet'
import { ReviewBoard } from './ReviewBoard'
import { useImportJob } from './useImportJob'

type Method = 'pdf' | 'agente' | 'manual'
type Step = 'entrada' | 'processando' | 'revisao' | 'concluido'

const METHODS: { id: Method; icon: typeof FileUp; title: string; text: string; badge: string }[] = [
  { id: 'pdf', icon: FileUp, title: 'PDF com IA', text: 'Envie o PDF (ou o de questões + o de gabarito): o texto é extraído no seu navegador e a IA separa, categoriza e completa as questões.', badge: 'Automático' },
  { id: 'agente', icon: Bot, title: 'Usar meu agente de IA', text: 'Copie nosso prompt, use no ChatGPT/Claude/Gemini com o PDF e cole aqui o JSON gerado.', badge: 'Melhor p/ imagens' },
  { id: 'manual', icon: PencilLine, title: 'Cadastrar manualmente', text: 'Digite enunciado, alternativas e resposta. A IA pode gerar as alternativas incorretas.', badge: 'Controle total' },
]

export function ImportPage() {
  const { commitImport } = useStore()
  const [method, setMethod] = useState<Method>('pdf')
  const [step, setStep] = useState<Step>('entrada')
  const [pipelineIndex, setPipelineIndex] = useState(0)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [saved, setSaved] = useState<{ saved: number; duplicates: number }>({ saved: 0, duplicates: 0 })
  const [problems, setProblems] = useState<ReviewProblem[]>([])
  const queryClient = useQueryClient()
  const [visibility, setVisibility] = useState<Visibility>('publica')
  // API real (sessão do Better Auth) → job no servidor; protótipo sem API → pipeline simulado
  const real = useAuth().mode === 'real'
  const job = useImportJob()
  const [jobVision, setJobVision] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)

  // Autosave da revisão (T042): 2 s depois da última edição, no job do servidor.
  useEffect(() => {
    if (!real || step !== 'revisao' || !review?.jobId) return
    const t = setTimeout(() => {
      saveReviewDraft(review).then(
        () => setDraftSavedAt(new Date()),
        () => undefined, // sem rede: tenta de novo na próxima edição
      )
    }, 2000)
    return () => clearTimeout(t)
  }, [real, step, review])

  /** Agente externo: cria o job já na revisão (JSON revalidado no servidor) para o autosave funcionar. */
  async function openAgentReview(state: ReviewState) {
    await process(() => state, false)
    if (!real || !state.payload) return
    createReviewJob({ source: 'agente_externo', payload: state.payload }).then(
      (jobId) => setReview((cur) => (cur && cur.payload === state.payload ? { ...cur, jobId } : cur)),
      () => undefined, // o commit cria o job se ainda faltar
    )
  }

  // Salvar de verdade (T027): POST /api/imports/:id/commit; erros de validação voltam para a revisão.
  const commit = useMutation({
    mutationFn: (r: ReviewState) => commitReview(r, (jobId) => setReview((cur) => (cur ? { ...cur, jobId } : cur))),
    onMutate: () => setProblems([]),
    onSuccess: (r) => {
      setSaved({ saved: r.saved, duplicates: r.duplicates })
      setStep('concluido')
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
      void queryClient.invalidateQueries({ queryKey: ['imports'] })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (err) => {
      if (err instanceof CommitError) setProblems(err.problems)
    },
  })

  /** Job terminou no servidor → rascunhos + cards da IA na revisão. */
  function openJobReview(view: ImportJobView | null, fileName?: string) {
    if (!view) return // erro/cota/cancelado: o cartão de progresso mostra o que fazer
    // Revisão salva automaticamente (T042) tem prioridade: reabre com as edições feitas.
    const base = view.reviewDraft
      ? (view.reviewDraft as unknown as ReviewState)
      : view.payload
        ? draftsFromImportFile(view.payload, visibility)
        : draftsFromServerJob(view, visibility, fileName)
    setReview({ ...base, jobId: view.id })
    setProblems([])
    setStep('revisao')
    job.reset()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function processPdf(pdf: ExtractedPdf, opts: { vision: boolean }) {
    if (!real) {
      const docs = pdf.parts && (pdf.parts.length > 1 || pdf.parts[0].role !== 'misto') ? documentsOf(pdf.parts) : undefined
      const seg = segmentImport(pdf.fullText, docs)
      return process(() => draftsFromSegments(seg.questions, visibility, pdf.fileName, seg.link))
    }
    setJobVision(opts.vision && pdf.pages.some((p) => p.imageRegions.length))
    setStep('processando')
    openJobReview(await job.start(pdf, opts), pdf.fileName)
  }

  async function resumeJob(jobId: string, fileName?: string) {
    setJobVision(false) // sem o PDF não há recortes: o servidor segue com o que já recebeu
    setStep('processando')
    openJobReview(await job.resume(jobId, fileName), fileName)
  }

  async function process(build: () => ReviewState, withPipeline = true) {
    if (withPipeline) {
      setStep('processando')
      await runMockPipeline(setPipelineIndex)
    }
    setReview(build())
    setProblems([])
    setStep('revisao')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Alimente seu banco"
        title="Importar questões"
        description="Transforme suas listas respondidas em questões de simulado. Você revisa tudo antes de salvar — nada entra no banco sem a sua confirmação."
      />

      <Stepper step={step} />

      {step === 'entrada' && (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={clsx(
                  'card flex flex-col items-start p-5 text-left transition',
                  method === m.id ? 'border-brand-500 ring-4 ring-brand-100' : 'hover:border-brand-200',
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className={clsx('rounded-xl p-2.5', method === m.id ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600')}>
                    <m.icon size={20} />
                  </span>
                  <Badge tone={method === m.id ? 'brand' : 'neutral'}>{m.badge}</Badge>
                </div>
                <p className="mt-3 font-display font-bold">{m.title}</p>
                <p className="mt-1 text-sm text-muted">{m.text}</p>
              </button>
            ))}
          </div>

          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={visibility === 'publica'} onChange={(e) => setVisibility(e.target.checked ? 'publica' : 'privada')} />
            Compartilhar as questões importadas com a comunidade (outros estudantes poderão usá-las em simulados)
          </label>

          {real && job.pending && job.state.status === 'idle' && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
              <Loader2 size={18} className="shrink-0 text-brand-600" />
              <p className="min-w-0 flex-1">
                Importação em andamento: <b>{job.pending.fileName}</b>. O progresso está salvo no servidor.
              </p>
              <Button size="sm" onClick={() => resumeJob(job.pending!.id, job.pending!.fileName)}>
                Continuar
              </Button>
              <Button size="sm" variant="ghost" onClick={job.discardPending}>
                Descartar
              </Button>
            </div>
          )}

          {real && <OpenImports hide={job.pending?.id} onOpen={(j) => resumeJob(j.id, j.fileName ?? undefined)} />}

          {method === 'pdf' && <PdfPanel real={real} onProcess={processPdf} />}
          {method === 'agente' && <AgentPanel onImport={(r) => void openAgentReview(draftsFromImportFile(r.data!, visibility))} />}
          {method === 'manual' && <ManualPanel visibility={visibility} onDone={(s) => process(() => s, false)} />}
        </>
      )}

      {step === 'processando' &&
        (real ? (
          <JobProgressCard
            state={job.state}
            withVision={jobVision}
            onResume={() => job.state.jobId && resumeJob(job.state.jobId, job.state.fileName ?? undefined)}
            onBack={() => {
              job.reset()
              setStep('entrada')
            }}
            onUseAgent={() => {
              job.reset()
              setMethod('agente')
              setStep('entrada')
            }}
          />
        ) : (
          <PipelineProgress index={pipelineIndex} />
        ))}

      {step === 'revisao' && review && real && review.jobId && (
        <p className="mb-2 text-right text-xs text-muted" aria-live="polite">
          {draftSavedAt ? `Rascunho salvo às ${draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — dá para fechar e continuar depois` : 'Suas edições são salvas automaticamente'}
        </p>
      )}
      {step === 'revisao' && review && (
        <ReviewBoard
          state={review}
          onChange={(next) => {
            setReview(next)
            // Problemas de questões removidas/editadas somem; os demais são reavaliados ao salvar.
            setProblems((ps) =>
              ps.filter((p) =>
                p.draftId
                  ? next.drafts[p.draftId] && next.drafts[p.draftId] === review.drafts[p.draftId]
                  : !p.cardId || next.cards.find((c) => c.id === p.cardId) === review.cards.find((c) => c.id === p.cardId),
              ),
            )
          }}
          onBack={() => setStep('entrada')}
          saving={commit.isPending}
          problems={problems}
          // CommitError sem itens (400 sem lista) também precisa aparecer — antes ficava mudo.
          error={commit.error && (!(commit.error instanceof CommitError) || !commit.error.problems.length) ? commit.error.message : problems.length ? null : undefined}
          onConfirm={() => {
            if (!real) {
              const n = commitImport(review.cards, review.drafts) || review.cards.reduce((a, c) => a + c.questionIds.length, 0)
              setSaved({ saved: n, duplicates: 0 })
              return setStep('concluido')
            }
            commit.mutate(review)
          }}
        />
      )}

      {step === 'concluido' && (
        <Card className="mx-auto max-w-xl p-8 text-center">
          <PartyPopper className="mx-auto text-gold-600" size={40} />
          <h2 className="mt-3 text-2xl font-extrabold">
            {saved.saved} {saved.saved === 1 ? 'questão salva' : 'questões salvas'}!
          </h2>
          <p className="mt-2 text-sm text-muted">
            {saved.saved > 0 ? 'Elas já estão no seu banco e prontas para entrar nos seus simulados.' : 'Nada novo para salvar.'}
            {saved.duplicates > 0 && ` ${saved.duplicates} ${saved.duplicates === 1 ? 'já estava' : 'já estavam'} no seu banco e ${saved.duplicates === 1 ? 'foi ignorada' : 'foram ignoradas'}.`}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to="/simulados">
              <Button>
                <Timer size={16} /> Criar simulado
              </Button>
            </Link>
            <Link to="/questoes">
              <Button variant="secondary">Ver banco de questões</Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setReview(null)
                setStep('entrada')
              }}
            >
              Importar mais
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

interface OpenJob {
  id: string
  source: 'pdf_ia' | 'agente_externo' | 'manual'
  fileName: string | null
  status: 'processando' | 'revisao'
  updatedAt: string
}

/**
 * Importações que ainda não foram salvas (T035): o resultado da IA fica no servidor, então dá para
 * voltar à revisão depois de recarregar a página ou trocar de dispositivo.
 */
function OpenImports({ hide, onOpen }: { hide?: string; onOpen: (job: OpenJob) => void }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['imports', 'abertas'],
    queryFn: async () => (await unwrap(apiFetch('/api/imports'))) as { jobs: (Omit<OpenJob, 'status'> & { status: string })[] },
    staleTime: 10_000,
  })
  // Remover (T063): o servidor marca como cancelada e apaga o conteúdo; some da lista na hora.
  const remove = useMutation({
    mutationFn: (id: string) => removeImport(id),
    onSuccess: (_, id) => {
      setConfirming(null)
      queryClient.setQueryData<{ jobs: { id: string }[] }>(['imports', 'abertas'], (d) => (d ? { ...d, jobs: d.jobs.filter((j) => j.id !== id) } : d))
      void queryClient.invalidateQueries({ queryKey: ['imports'] })
    },
  })
  const jobs = (q.data?.jobs ?? []).filter(
    (j): j is OpenJob => (j.status === 'processando' || j.status === 'revisao') && j.source !== 'manual' && j.id !== hide,
  )
  if (!jobs.length) return null
  return (
    <section aria-labelledby="open-imports" className="mb-4 rounded-xl border border-line bg-white p-3">
      <h2 id="open-imports" className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
        Importações não salvas
      </h2>
      <ul className="space-y-2">
        {jobs.slice(0, 5).map((j) => {
          const name = j.fileName || (j.source === 'agente_externo' ? 'JSON do agente' : 'PDF')
          const removing = remove.isPending && remove.variables === j.id
          return (
            <li key={j.id} className="flex flex-wrap items-center gap-2 text-sm">
              {j.status === 'processando' ? <Loader2 size={16} className="shrink-0 text-brand-600" /> : <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />}
              <span className="min-w-0 flex-1 truncate">
                <b>{name}</b>
                <span className="text-muted"> · {j.status === 'processando' ? 'processando' : 'pronta para revisar'} · {new Date(j.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </span>
              {confirming === j.id ? (
                <span className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto" role="group" aria-label={`Confirmar remoção de ${name}`}>
                  <span className="text-xs text-muted">Remover? O resultado da IA e suas edições serão apagados.</span>
                  <Button size="sm" variant="danger" disabled={removing} onClick={() => remove.mutate(j.id)}>
                    {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remover
                  </Button>
                  <Button size="sm" variant="ghost" disabled={removing} onClick={() => setConfirming(null)}>
                    Cancelar
                  </Button>
                </span>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => onOpen(j)}>
                    {j.status === 'processando' ? 'Continuar' : 'Revisar'}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remover ${name}`} title="Remover" onClick={() => setConfirming(j.id)}>
                    <Trash2 size={16} />
                  </Button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {remove.error && (
        <p role="alert" className="mt-2 text-xs text-rose-600">
          {remove.error.message}
        </p>
      )}
    </section>
  )
}

/** DELETE /api/imports/:id (T063): descarta uma importação não salva. */
async function removeImport(id: string) {
  await unwrap(apiFetch(`/api/imports/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'entrada', label: 'Entrada' },
    { id: 'processando', label: 'Processamento' },
    { id: 'revisao', label: 'Revisão' },
    { id: 'concluido', label: 'Salvo' },
  ]
  const idx = steps.findIndex((s) => s.id === step)
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-bold">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span className={clsx('flex size-6 items-center justify-center rounded-full', i <= idx ? 'bg-brand-600 text-white' : 'bg-brand-50 text-muted')}>{i + 1}</span>
          <span className={clsx('hidden sm:inline', i <= idx ? 'text-ink' : 'text-muted')}>{s.label}</span>
          {i < steps.length - 1 && <span className="h-px w-6 bg-line sm:w-10" />}
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------ PDF ------------------------------ */

interface PdfFile {
  pdf: ExtractedPdf
  role: DocumentRole
  /** O usuário escolheu o papel (não é mais sugerido automaticamente). */
  touched: boolean
}

function PdfPanel({ real, onProcess }: { real: boolean; onProcess: (pdf: ExtractedPdf, opts: { vision: boolean }) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<PdfFile[]>([])
  const [vision, setVision] = useState(true)
  const [progress, setProgress] = useState<{ name: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showText, setShowText] = useState(false)

  /** Papéis sugeridos para quem o usuário ainda não mexeu (1 arquivo: "misto"; 2+: lidos do conteúdo). */
  function withSuggestedRoles(list: PdfFile[]): PdfFile[] {
    const suggested = suggestRoles(list.map((f) => f.pdf))
    return list.map((f, i) => (f.touched ? f : { ...f, role: suggested[i].role }))
  }

  async function handle(picked: File[]) {
    if (!picked.length) return
    const bad = picked.find((f) => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'))
    if (bad) return setError(`"${bad.name}" não é um arquivo .pdf`)
    const big = picked.find((f) => f.size > 30 * 1024 * 1024)
    if (big) return setError(`"${big.name}" tem mais de 30 MB. Divida o PDF em partes.`)
    if (files.length + picked.length > MAX_PDFS) return setError(`Envie no máximo ${MAX_PDFS} PDFs por importação.`)
    setError(null)
    const out: PdfFile[] = []
    try {
      // pdf.js (~1 MB) só é baixado quando o usuário escolhe um arquivo
      const { extractPdf } = await import('./pdfExtract')
      for (const file of picked) {
        setProgress({ name: file.name, done: 0, total: 1 })
        out.push({ pdf: await extractPdf(file, (done, total) => setProgress({ name: file.name, done, total })), role: 'misto', touched: false })
      }
    } catch (e) {
      setError(`Não foi possível ler o PDF: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
    if (out.length) setFiles((cur) => withSuggestedRoles([...cur, ...out]))
  }

  const setRole = (i: number, role: DocumentRole) => setFiles((cur) => cur.map((f, k) => (k === i ? { ...f, role, touched: true } : f)))
  const remove = (i: number) => setFiles((cur) => withSuggestedRoles(cur.filter((_, k) => k !== i)))

  const pdf = useMemo(() => (files.length ? mergePdfs(files.map((f) => ({ pdf: f.pdf, role: f.role }))) : null), [files])
  // Mesma segmentação do servidor (nó `segment`): questões, perguntas e respostas ligadas do gabarito
  const analysis = useMemo(() => (pdf ? segmentImport(pdf.fullText, pdf.parts && (pdf.parts.length > 1 || pdf.parts[0].role !== 'misto') ? documentsOf(pdf.parts) : undefined) : null), [pdf])
  const segments = analysis?.questions ?? []
  const link = analysis?.link ?? null
  const imagePages = pdf?.pages.filter((p) => p.images > 0) ?? []
  const ocrPages = pdf?.pages.filter((p) => p.needsOcr) ?? []
  const usefulImages = pdf?.pages.reduce((a, p) => a + p.imageRegions.length, 0) ?? 0
  const guard = useMemo(() => (pdf ? inspectText(pdf.fullText) : null), [pdf])
  const problem = pdf?.parts ? setProblem(pdf.parts) : null
  const answered = segments.reduce((a, s) => a + s.items.filter((i) => i.answer || i.choices).length, 0)

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      void handle([...e.dataTransfer.files])
    },
  }
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      onChange={(e) => {
        void handle([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  )

  return (
    <Card className="p-5 sm:p-6">
      {!pdf && (
        <div {...dropProps} className={clsx('flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition', dragOver ? 'border-brand-500 bg-brand-50' : 'border-brand-200')}>
          {progress ? (
            <>
              <Loader2 className="animate-spin text-brand-600" size={36} />
              <p className="mt-3 font-display font-bold">
                Lendo página {progress.done} de {progress.total}…
              </p>
              <p className="max-w-full truncate text-xs text-muted">{progress.name} · a extração acontece no seu navegador — o PDF não é enviado.</p>
            </>
          ) : (
            <>
              <UploadCloud className="text-brand-500" size={40} />
              <p className="mt-3 font-display font-bold">Arraste o PDF aqui</p>
              <p className="text-sm text-muted">ou</p>
              <Button className="mt-2" onClick={() => input.current?.click()}>
                <FileUp size={16} /> Escolher arquivo(s)
              </Button>
              <p className="mt-4 max-w-md text-xs text-muted">
                Questões e gabarito em arquivos separados? Envie os dois juntos (até {MAX_PDFS} PDFs, 30 MB cada) — as respostas são ligadas às questões pelo número.
              </p>
            </>
          )}
          {fileInput}
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}

      {pdf && (
        <div className="space-y-5">
          <ul className="space-y-2" aria-label="Arquivos da importação">
            {files.map((f, i) => {
              const part = pdf.parts?.[i]
              return (
                <li key={`${f.pdf.fileName}-${i}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                  <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
                    <FileText size={20} />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-display font-bold">{f.pdf.fileName}</p>
                    <p className="text-xs text-muted">
                      {(f.pdf.sizeBytes / 1024 / 1024).toFixed(1)} MB · {f.pdf.pages.length} páginas{files.length > 1 && part ? ` (pág. ${part.firstPage}–${part.firstPage + part.pageCount - 1} da importação)` : ''}
                    </p>
                  </div>
                  <label className="flex min-w-0 basis-full flex-col gap-1 text-xs font-bold text-muted sm:basis-56">
                    O que tem neste arquivo
                    <select className={inputClass} value={f.role} onChange={(e) => setRole(i, e.target.value as DocumentRole)}>
                      {DOCUMENT_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    {files.length > 1 && part && !f.touched && <span className="font-normal">Sugerido pela leitura: {part.detected.reason}.</span>}
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => remove(i)} aria-label={`Remover ${f.pdf.fileName}`}>
                    <Trash2 size={14} /> Remover
                  </Button>
                </li>
              )
            })}
          </ul>
          {progress ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="animate-spin" size={14} /> Lendo {progress.name}: página {progress.done} de {progress.total}…
            </p>
          ) : (
            files.length < MAX_PDFS && (
              <div {...dropProps} className={clsx('flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed p-3 text-sm', dragOver ? 'border-brand-500 bg-brand-50' : 'border-line')}>
                <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
                  <FilePlus2 size={14} /> Adicionar outro PDF
                </Button>
                <span className="text-xs text-muted">ex.: o gabarito, se as respostas estão em outro arquivo</span>
                {fileInput}
              </div>
            )
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Questões (enunciados)" value={segments.length} tone="brand" />
            <Stat label="Perguntas" value={segments.reduce((a, s) => a + s.items.length, 0)} tone="brand" />
            <Stat label="Perguntas com resposta" value={answered} tone="green" />
            <Stat label="Páginas com imagens" value={imagePages.length} tone="blue" />
          </div>

          {link && <LinkPreview link={link} sectionPage={analysis?.answerSectionPage} />}

          {imagePages.length > 0 && (
            <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <ImageIcon size={18} className="mt-0.5 shrink-0" />
              <p>
                {imagePages.length} página(s) contêm imagens (ex.: esquemas POP-Q) — {usefulImages} com conteúdo. O recorte de cada uma é gerado no seu navegador e enviado a um <b>modelo de visão gratuito</b>, que transcreve o quadro/foto
                para dentro da questão
                {ocrPages.length > 0 && <> ({ocrPages.length} página(s) parecem escaneadas)</>}. Fotos borradas podem sair com trechos “[ilegível]”: confira na revisão ou use o método <b>“Usar meu agente de IA”</b>.
              </p>
            </div>
          )}

          {usefulImages > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={vision} onChange={(e) => setVision(e.target.checked)} />
              <span>
                Transcrever as {usefulImages} imagens com IA (visão) — +{Math.ceil(usefulImages / 3)} chamadas, ~{Math.max(1, Math.round((usefulImages / 3) * 0.7))} min.
                <span className="block text-xs text-muted">Desmarcado: as questões ficam com “[Imagem p. N]” para você conferir no PDF.</span>
              </span>
            </label>
          )}

          {usefulImages > 0 && vision && <VisionPreview pdf={pdf} />}

          {guard && guard.findings.length > 0 && (
            <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <p>
                Guardrail encontrou {guard.findings.length} trecho(s) suspeito(s) ({[...new Set(guard.findings.map((f) => f.label))].join(', ')}). Eles serão removidos antes de qualquer envio à IA.
              </p>
            </div>
          )}

          <div>
            <button className="text-sm font-bold text-brand-600 hover:underline" onClick={() => setShowText((v) => !v)}>
              {showText ? 'Ocultar' : 'Ver'} texto extraído
            </button>
            {showText && (
              <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{pdf.fullText.slice(0, 20000)}</pre>
            )}
          </div>

          {problem && <p className="rounded-xl bg-gold-50 p-3 text-sm font-bold text-gold-600">{problem}</p>}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            <span className="text-xs text-muted">
              Estimativa: ~{Math.max(1, Math.ceil(segments.length / 3))} chamadas de IA (lotes de 3 questões)
              {usefulImages > 0 && vision && <> + {Math.ceil(usefulImages / 3)} de visão (lotes de 3 imagens)</>} {!real && <DemoTag />}
            </span>
            <Button size="lg" disabled={!segments.length || !!problem || !!progress} onClick={() => onProcess(pdf, { vision: vision && usefulImages > 0 })}>
              Processar com IA →
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** Resumo da ligação questões × gabarito, antes de processar (o mesmo cálculo do servidor). */
function LinkPreview({ link, sectionPage }: { link: LinkReport; sectionPage?: number }) {
  const ok = link.entries > 0 && link.linkedQuestions === link.questions && !link.orphanEntries.length
  const tone = !link.entries ? 'border-rose-200 bg-rose-50 text-rose-900' : ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gold-300 bg-gold-50 text-slate-800'
  return (
    <div role="status" className={clsx('rounded-xl border p-3 text-sm', tone)}>
      <p className="flex items-start gap-2">
        <Link2 size={18} className="mt-0.5 shrink-0" />
        <span>
          {sectionPage ? <>Gabarito encontrado no fim do arquivo (pág. {sectionPage}). </> : null}
          {linkSummary(link)}
          {link.entries > 0 && !ok && <> Questões sem resposta ficam marcadas na revisão; a IA tenta ligar as que sobraram.</>}
        </span>
      </p>
      {(link.unmatchedQuestions.length > 0 || link.orphanEntries.length > 0) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-bold">Ver o que não foi ligado</summary>
          {link.unmatchedQuestions.length > 0 && (
            <p className="mt-2 break-words text-xs">
              <b>Questões sem resposta ({link.unmatchedQuestions.length}):</b> {link.unmatchedQuestions.map((q) => q.label ?? `p. ${q.page ?? '?'}`).join(', ')}
            </p>
          )}
          {link.orphanEntries.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              <li className="font-bold">Respostas sem questão ({link.orphanEntries.length}):</li>
              {link.orphanEntries.slice(0, 20).map((o) => (
                <li key={o.id} className="break-words">
                  <span className="font-mono">{o.label ?? o.id}</span> {o.preview}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}

/** Prévia da etapa de visão: gera no navegador os recortes JPEG que iriam ao modelo de visão. */
function VisionPreview({ pdf }: { pdf: ExtractedPdf }) {
  const [crops, setCrops] = useState<PageImageCrop[] | null>(null)
  const [batches, setBatches] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setError(null)
    setProgress({ done: 0, total: 1 })
    try {
      // pdf.js já foi carregado na extração; o módulo de recortes vem sob demanda
      const { renderPageImages } = await import('./pageImages')
      const out = await renderPageImages(pdf, { onProgress: (done, total) => setProgress({ done, total }) })
      setCrops(out)
      setBatches(batchPageImages(out).length)
    } catch (e) {
      setError(`Não foi possível gerar os recortes: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  const kb = crops ? Math.round(crops.reduce((a, c) => a + (c.base64.length * 3) / 4, 0) / 1024) : 0
  return (
    <div className="rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-muted">
          {crops ? (
            <>
              <b className="text-ink">{crops.length} recortes</b> · {kb.toLocaleString('pt-BR')} KB de JPEG · {batches} lote(s) de até 3 imagens (1 chamada de visão cada)
            </>
          ) : (
            'Veja exatamente o que será enviado ao modelo de visão (só os recortes das imagens — o PDF não sai do seu navegador).'
          )}
        </p>
        {!crops && (
          <Button variant="ghost" size="sm" disabled={!!progress} onClick={generate}>
            {progress ? (
              <>
                <Loader2 className="animate-spin" size={14} /> {progress.done}/{progress.total}
              </>
            ) : (
              <>
                <ImageIcon size={14} /> Ver recortes
              </>
            )}
          </Button>
        )}
      </div>
      {error && <p className="mt-2 font-bold text-rose-700">{error}</p>}
      {crops && crops.length > 0 && (
        <ul className="scrollbar-thin mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-auto sm:grid-cols-4" aria-label="Recortes das imagens">
          {crops.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-white p-1">
              <img src={`data:image/jpeg;base64,${c.base64}`} alt={`Imagem ${c.id} (página ${c.page})`} className="h-24 w-full object-contain" />
              <p className="mt-1 truncate text-center text-[11px] text-muted">
                p. {c.page} · {Math.round((c.base64.length * 3) / 4 / 1024)} KB
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'brand' | 'green' | 'blue' }) {
  return (
    <div className={clsx('rounded-xl p-4', tone === 'brand' && 'bg-brand-50', tone === 'green' && 'bg-emerald-50', tone === 'blue' && 'bg-sky-50')}>
      <p className="font-display text-2xl font-extrabold">{value}</p>
      <p className="text-xs font-bold text-muted">{label}</p>
    </div>
  )
}

/* --------------------------- Agente externo --------------------------- */

function AgentPanel({ onImport }: { onImport: (r: ImportValidationResult) => void }) {
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<ImportValidationResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const guard = text ? inspectText(text) : null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-bold">1. Copie o prompt</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Abra o agente de IA que preferir (ChatGPT, Claude, Gemini…).</li>
          <li>Anexe o PDF (ou os PDFs de questões e de gabarito, juntos) e cole o prompt abaixo.</li>
          <li>Copie o bloco JSON da resposta e cole ao lado.</li>
        </ol>
        <pre className="scrollbar-thin mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{EXTERNAL_AGENT_PROMPT}</pre>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(EXTERNAL_AGENT_PROMPT)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              /* sem permissão de clipboard */
            }
          }}
        >
          {copied ? <CheckCircle2 size={16} className="text-emerald-600" /> : <ClipboardCopy size={16} />} {copied ? 'Copiado!' : 'Copiar prompt'}
        </Button>
      </Card>

      <Card className="flex flex-col p-5">
        <h3 className="font-bold">2. Cole o JSON gerado</h3>
        <textarea
          className={clsx(inputClass, 'mt-3 min-h-64 flex-1 font-mono text-xs')}
          placeholder={'```json\n{ "versao": "1.0", "questoes": [ … ] }\n```'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setResult(null)
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
            <FileUp size={14} /> Carregar arquivo (.json/.md/.txt)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setText(SAMPLE_JSON)}>
            Usar exemplo
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.md,.txt,application/json,text/plain,text/markdown"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              if (f.size > 5 * 1024 * 1024) return setResult({ ok: false, errors: [{ path: '(arquivo)', message: 'Arquivo maior que 5 MB.' }] })
              setText(await f.text())
              setResult(null)
              e.target.value = ''
            }}
          />
        </div>
        {guard && guard.findings.length > 0 && (
          <p className="mt-3 flex gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">
            <ShieldAlert size={16} className="shrink-0" /> Guardrail: {guard.findings.length} trecho(s) suspeito(s) serão removidos ({[...new Set(guard.findings.map((f) => f.label))].join(', ')}).
          </p>
        )}
        {result && !result.ok && (
          <div className="mt-3 max-h-40 overflow-auto rounded-xl bg-rose-50 p-3 text-xs text-rose-800">
            <p className="mb-1 font-bold">O JSON não passou na validação:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {result.errors.map((e, i) => (
                <li key={i}>
                  <code>{e.path}</code>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button
          className="mt-3"
          disabled={!text.trim()}
          onClick={() => {
            const r = parseImportText(text)
            setResult(r)
            if (r.ok) onImport(r)
          }}
        >
          Validar e revisar →
        </Button>
      </Card>
    </div>
  )
}

const SAMPLE_JSON = `\`\`\`json
{
  "versao": "2.0",
  "origem": {
    "arquivo": "lista-de-exercicios.pdf"
  },
  "questoes": [
    {
      "area": "Medicina",
      "disciplina": "Cardiologia",
      "assunto": "Hipertensão arterial",
      "rotulo": "QUESTÃO 1",
      "enunciado": "Carlos tem 52 anos, é sedentário, assintomático e procurou a unidade de saúde para consulta de rotina. A pressão arterial foi de 150/95 mmHg em duas consultas, com intervalo de 15 dias. Exame físico sem outras alterações. Responda:",
      "perguntas": [
        {
          "rotulo": "a",
          "texto": "Qual o diagnóstico mais provável e como confirmá-lo?",
          "tipo": "discursiva",
          "resposta_esperada": "Hipertensão arterial estágio 1; confirmar com medidas fora do consultório (MAPA ou MRPA) para excluir o efeito do avental branco.",
          "pontos_chave": [
            "Hipertensão arterial estágio 1",
            "Confirmar com MAPA ou MRPA",
            "Excluir efeito do avental branco"
          ],
          "alternativas": [
            {
              "texto": "Hipertensão estágio 1; confirmar com MAPA ou MRPA",
              "correta": true,
              "gerada_por_ia": true
            },
            {
              "texto": "Pressão normal; nenhuma conduta",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Valores ≥ 140/90 mmHg em mais de uma consulta são compatíveis com hipertensão."
            },
            {
              "texto": "Hipertensão estágio 3; internar imediatamente",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Estágio 3 exige PA ≥ 180/110 mmHg."
            },
            {
              "texto": "Crise hipertensiva; reduzir a pressão em minutos",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Paciente assintomático e sem valores de crise."
            },
            {
              "texto": "Pré-hipertensão; repetir a medida em 5 anos",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Os valores já atingem o critério de hipertensão."
            }
          ]
        },
        {
          "rotulo": "b",
          "texto": "Qual destas medidas faz parte do tratamento não farmacológico?",
          "tipo": "objetiva",
          "alternativas": [
            {
              "texto": "Reduzir o sal da dieta e praticar atividade física regular",
              "correta": true,
              "explicacao": "Mudanças de estilo de vida reduzem a pressão arterial."
            },
            {
              "texto": "Aumentar o consumo de alimentos industrializados",
              "correta": false
            },
            {
              "texto": "Suspender toda atividade física",
              "correta": false
            },
            {
              "texto": "Nenhuma medida é necessária",
              "correta": false
            }
          ]
        }
      ],
      "dificuldade": "media",
      "pagina": 2
    },
    {
      "area": "Matemática",
      "disciplina": "Cálculo",
      "assunto": "Derivadas",
      "rotulo": "QUESTÃO 2",
      "enunciado": "Observe o gráfico da função f(x) = x² − 4x + 3.\\n[Imagem: parábola com raízes em x = 1 e x = 3 e vértice em (2, −1)]\\nPara ela:",
      "perguntas": [
        {
          "rotulo": "a",
          "texto": "calcule f'(x);",
          "tipo": "discursiva",
          "resposta_esperada": "f'(x) = 2x − 4.",
          "pontos_chave": [
            "Regra da potência",
            "f'(x) = 2x − 4"
          ]
        },
        {
          "rotulo": "b",
          "texto": "determine o ponto de mínimo.",
          "tipo": "discursiva",
          "resposta_esperada": "f'(x) = 0 em x = 2; o ponto de mínimo é (2, −1).",
          "pontos_chave": [
            "f'(x) = 0 em x = 2",
            "Ponto de mínimo (2, −1)"
          ]
        }
      ],
      "tem_imagem": true,
      "descricao_imagem": "Gráfico de uma parábola com concavidade para cima.",
      "dificuldade": "facil",
      "pagina": 3
    }
  ]
}
\`\`\``

/* ------------------------------ Manual ------------------------------ */

function ManualPanel({ visibility, onDone }: { visibility: Visibility; onDone: (s: ReviewState) => void }) {
  const [area, setArea] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [topic, setTopic] = useState('')
  const [list, setList] = useState<DraftQuestion[]>([])
  const [editing, setEditing] = useState<DraftQuestion | null>(null)

  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Área">
          <input className={inputClass} value={area} placeholder="ex.: Medicina" onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label="Disciplina">
          <input className={inputClass} value={discipline} placeholder="ex.: Cardiologia" onChange={(e) => setDiscipline(e.target.value)} />
        </Field>
        <Field label="Assunto">
          <input className={inputClass} value={topic} placeholder="ex.: Hipertensão arterial" onChange={(e) => setTopic(e.target.value)} />
        </Field>
      </div>

      <div className="mt-5 space-y-2">
        {list.map((q, i) => (
          <div key={q.id} className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm">
            <span className="font-display font-bold text-muted">{i + 1}</span>
            <Badge tone="blue">{q.items.length > 1 ? `${q.items.length} perguntas` : 'pergunta única'}</Badge>
            <p className="min-w-0 flex-1 truncate">{q.stem}</p>
            <button className="text-xs font-bold text-brand-600" onClick={() => setEditing(q)}>
              Editar
            </button>
            <button className="text-xs font-bold text-rose-600" onClick={() => setList(list.filter((x) => x.id !== q.id))}>
              Remover
            </button>
          </div>
        ))}
        {!list.length && <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">Nenhuma questão ainda.</p>}
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={() => setEditing(emptyDraft(visibility))}>
          <PencilLine size={16} /> Nova questão
        </Button>
        <Button
          disabled={!list.length || !area.trim() || !discipline.trim()}
          onClick={() =>
            onDone({
              source: 'manual',
              drafts: Object.fromEntries(list.map((q) => [q.id, q])),
              cards: [{ id: `card-manual`, area, discipline, topic, description: '', questionIds: list.map((q) => q.id) }],
            })
          }
        >
          Revisar {list.length} questão(ões) →
        </Button>
      </div>

      {editing && (
        <QuestionEditor
          open
          title="Nova questão"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(q) => {
            setList((l) => (l.some((x) => x.id === q.id) ? l.map((x) => (x.id === q.id ? q : x)) : [...l, q]))
            setEditing(null)
          }}
        />
      )}
    </Card>
  )
}

/* --------------------------- Processamento --------------------------- */

function PipelineProgress({ index }: { index: number }) {
  return (
    <Card className="mx-auto max-w-xl p-6">
      <h2 className="text-lg font-bold">Processando questões…</h2>
      <p className="mt-1 text-sm text-muted">
        Modelos gratuitos do OpenRouter com fallback automático. <DemoTag />
      </p>
      <ol className="mt-5 space-y-3">
        {PIPELINE_STEPS.map((s, i) => (
          <li key={s.id} className="flex items-start gap-3">
            <span className="mt-0.5">
              {i < index ? (
                <CheckCircle2 size={20} className="text-emerald-600" />
              ) : i === index ? (
                <Loader2 size={20} className="animate-spin text-brand-600" />
              ) : (
                <span className="block size-5 rounded-full border-2 border-line" />
              )}
            </span>
            <div>
              <p className={clsx('text-sm font-bold', i > index && 'text-muted')}>{s.label}</p>
              <p className="text-xs text-muted">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
