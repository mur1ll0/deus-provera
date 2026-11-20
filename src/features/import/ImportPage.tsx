import clsx from 'clsx'
import { Bot, CheckCircle2, ClipboardCopy, FileText, FileUp, ImageIcon, Loader2, PencilLine, PartyPopper, ShieldAlert, Timer, Trash2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Visibility } from '@shared/domain'
import { inspectText } from '@shared/guardrails'
import { EXTERNAL_AGENT_PROMPT } from '@shared/prompts/external-agent'
import { parseImportText, type ImportValidationResult } from '@shared/schemas/import'
import { segmentQuestions } from '@shared/segmenter'
import { Badge, Button, Card, DemoTag, Field, inputClass, PageHeader } from '@/components/ui'
import { PIPELINE_STEPS, runMockPipeline } from '@/mocks/ai'
import { useStore } from '@/mocks/store'
import { type DraftQuestion } from '@/mocks/model'
import { QuestionEditor } from '@/features/questions/QuestionEditor'
import { useAuth } from '@/app/auth-context'
import { draftsFromImportFile, draftsFromSegments, draftsFromServerJob, emptyDraft, type ReviewState } from './drafts'
import { batchPageImages, type ImportJobView } from './importJob'
import { JobProgressCard } from './JobProgress'
import type { PageImageCrop } from './pageImages'
import type { ExtractedPdf } from './pdfExtract'
import { ReviewBoard } from './ReviewBoard'
import { useImportJob } from './useImportJob'

type Method = 'pdf' | 'agente' | 'manual'
type Step = 'entrada' | 'processando' | 'revisao' | 'concluido'

const METHODS: { id: Method; icon: typeof FileUp; title: string; text: string; badge: string }[] = [
  { id: 'pdf', icon: FileUp, title: 'PDF com IA', text: 'Envie o PDF: o texto é extraído no seu navegador e a IA separa, categoriza e completa as questões.', badge: 'Automático' },
  { id: 'agente', icon: Bot, title: 'Usar meu agente de IA', text: 'Copie nosso prompt, use no ChatGPT/Claude/Gemini com o PDF e cole aqui o JSON gerado.', badge: 'Melhor p/ imagens' },
  { id: 'manual', icon: PencilLine, title: 'Cadastrar manualmente', text: 'Digite enunciado, alternativas e resposta. A IA pode gerar as alternativas incorretas.', badge: 'Controle total' },
]

export function ImportPage() {
  const { commitImport } = useStore()
  const [method, setMethod] = useState<Method>('pdf')
  const [step, setStep] = useState<Step>('entrada')
  const [pipelineIndex, setPipelineIndex] = useState(0)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [visibility, setVisibility] = useState<Visibility>('publica')
  // API real (sessão do Better Auth) → job no servidor; protótipo sem API → pipeline simulado
  const real = useAuth().mode === 'real'
  const job = useImportJob()
  const [jobVision, setJobVision] = useState(false)

  /** Job terminou no servidor → rascunhos + cards da IA na revisão. */
  function openJobReview(view: ImportJobView | null, fileName?: string) {
    if (!view) return // erro/cota/cancelado: o cartão de progresso mostra o que fazer
    setReview(draftsFromServerJob(view, visibility, fileName))
    setStep('revisao')
    job.reset()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function processPdf(pdf: ExtractedPdf, opts: { vision: boolean }) {
    if (!real) return process(() => draftsFromSegments(segmentQuestions(pdf.fullText), visibility, pdf.fileName))
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

          {method === 'pdf' && <PdfPanel real={real} onProcess={processPdf} />}
          {method === 'agente' && <AgentPanel onImport={(r) => process(() => draftsFromImportFile(r.data!, visibility), false)} />}
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

      {step === 'revisao' && review && (
        <ReviewBoard
          state={review}
          onChange={setReview}
          onBack={() => setStep('entrada')}
          onConfirm={() => {
            setSavedCount(commitImport(review.cards, review.drafts) || review.cards.reduce((a, c) => a + c.questionIds.length, 0))
            setStep('concluido')
          }}
        />
      )}

      {step === 'concluido' && (
        <Card className="mx-auto max-w-xl p-8 text-center">
          <PartyPopper className="mx-auto text-gold-600" size={40} />
          <h2 className="mt-3 text-2xl font-extrabold">{savedCount} questões salvas!</h2>
          <p className="mt-2 text-sm text-muted">Elas já estão no seu banco e prontas para entrar nos seus simulados.</p>
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

function PdfPanel({ real, onProcess }: { real: boolean; onProcess: (pdf: ExtractedPdf, opts: { vision: boolean }) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [pdf, setPdf] = useState<ExtractedPdf | null>(null)
  const [vision, setVision] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showText, setShowText] = useState(false)

  async function handle(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return setError('Envie um arquivo .pdf')
    if (file.size > 30 * 1024 * 1024) return setError('Arquivo maior que 30 MB. Divida o PDF em partes.')
    setError(null)
    setPdf(null)
    setProgress({ done: 0, total: 1 })
    try {
      // pdf.js (~1 MB) só é baixado quando o usuário escolhe um arquivo
      const { extractPdf } = await import('./pdfExtract')
      setPdf(await extractPdf(file, (done, total) => setProgress({ done, total })))
    } catch (e) {
      setError(`Não foi possível ler o PDF: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  const segments = pdf ? segmentQuestions(pdf.fullText) : []
  const imagePages = pdf?.pages.filter((p) => p.images > 0) ?? []
  const ocrPages = pdf?.pages.filter((p) => p.needsOcr) ?? []
  const usefulImages = pdf?.pages.reduce((a, p) => a + p.imageRegions.length, 0) ?? 0
  const guard = pdf ? inspectText(pdf.fullText) : null

  return (
    <Card className="p-5 sm:p-6">
      {!pdf && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handle(e.dataTransfer.files[0])
          }}
          className={clsx('flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition', dragOver ? 'border-brand-500 bg-brand-50' : 'border-brand-200')}
        >
          {progress ? (
            <>
              <Loader2 className="animate-spin text-brand-600" size={36} />
              <p className="mt-3 font-display font-bold">
                Lendo página {progress.done} de {progress.total}…
              </p>
              <p className="text-xs text-muted">A extração acontece no seu navegador — o PDF não é enviado.</p>
            </>
          ) : (
            <>
              <UploadCloud className="text-brand-500" size={40} />
              <p className="mt-3 font-display font-bold">Arraste o PDF aqui</p>
              <p className="text-sm text-muted">ou</p>
              <Button className="mt-2" onClick={() => input.current?.click()}>
                <FileUp size={16} /> Escolher arquivo
              </Button>
              <p className="mt-4 max-w-md text-xs text-muted">Teste com os PDFs de exemplo (Unidade II / III UNIDADE). Até 30 MB.</p>
            </>
          )}
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => handle(e.target.files?.[0])} />
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}

      {pdf && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
              <FileText size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display font-bold">{pdf.fileName}</p>
              <p className="text-xs text-muted">
                {(pdf.sizeBytes / 1024 / 1024).toFixed(1)} MB · {pdf.pages.length} páginas · {pdf.pages.reduce((a, p) => a + p.chars, 0).toLocaleString('pt-BR')} caracteres
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPdf(null)}>
              <Trash2 size={14} /> Trocar arquivo
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Questões (enunciados)" value={segments.length} tone="brand" />
            <Stat label="Perguntas" value={segments.reduce((a, s) => a + s.items.length, 0)} tone="brand" />
            <Stat label="Perguntas com resposta" value={segments.reduce((a, s) => a + s.items.filter((i) => i.answer).length, 0)} tone="green" />
            <Stat label="Páginas com imagens" value={imagePages.length} tone="blue" />
          </div>

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

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            <span className="text-xs text-muted">
              Estimativa: ~{Math.max(1, Math.ceil(segments.length / 3))} chamadas de IA (lotes de 3 questões)
              {usefulImages > 0 && vision && <> + {Math.ceil(usefulImages / 3)} de visão (lotes de 3 imagens)</>} {!real && <DemoTag />}
            </span>
            <Button size="lg" disabled={!segments.length} onClick={() => onProcess(pdf, { vision: vision && usefulImages > 0 })}>
              Processar com IA →
            </Button>
          </div>
        </div>
      )}
    </Card>
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
          <li>Anexe o PDF e cole o prompt abaixo.</li>
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
    "arquivo": "III UNIDADE.pdf"
  },
  "questoes": [
    {
      "area": "Medicina",
      "disciplina": "Ginecologia",
      "assunto": "HPV e lesões precursoras",
      "rotulo": "QUESTÃO 1",
      "enunciado": "Mulher de 22 anos, assintomática, veio para consulta de rotina. Sexarca aos 19 anos, parceiro único, nuligesta, em uso de ACO combinado. Citologia sugestiva de lesão intraepitelial de baixo grau. Exame físico normal. Responda:",
      "perguntas": [
        {
          "rotulo": "a",
          "texto": "Qual a melhor conduta?",
          "tipo": "discursiva",
          "resposta_esperada": "Até 24 anos, repetir a citologia em 3 anos; se normal, reiniciar o rastreamento aos 25 anos. Alterações mais graves: colposcopia.",
          "pontos_chave": [
            "Repetir citologia em 3 anos",
            "Alta taxa de regressão da LSIL até 24 anos",
            "Reiniciar rastreamento aos 25 anos"
          ],
          "alternativas": [
            {
              "texto": "Repetir a citologia em 3 anos e reiniciar o rastreamento aos 25",
              "correta": true,
              "gerada_por_ia": true
            },
            {
              "texto": "Colposcopia imediata com biópsia",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Indicada só se nova citologia vier pior."
            },
            {
              "texto": "Exérese da zona de transformação",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Sobretratamento para LSIL nessa idade."
            },
            {
              "texto": "Repetir a citologia em 6 meses",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Conduta para 25 anos ou mais."
            },
            {
              "texto": "Teste de DNA-HPV imediato",
              "correta": false,
              "gerada_por_ia": true,
              "explicacao": "Não recomendado abaixo de 25 anos."
            }
          ]
        },
        {
          "rotulo": "b",
          "texto": "O uso de preservativo elimina o risco de transmissão do HPV?",
          "tipo": "objetiva",
          "alternativas": [
            {
              "texto": "Não; reduz significativamente, mas o vírus pode estar em áreas não cobertas",
              "correta": true,
              "explicacao": "Vulva e períneo não ficam cobertos."
            },
            {
              "texto": "Sim; elimina completamente o risco",
              "correta": false
            },
            {
              "texto": "Não tem nenhum efeito sobre a transmissão",
              "correta": false
            },
            {
              "texto": "Só é útil se houver lesão visível",
              "correta": false
            }
          ]
        }
      ],
      "dificuldade": "media",
      "pagina": 2
    },
    {
      "area": "Medicina",
      "disciplina": "Ginecologia",
      "assunto": "Prolapso genital",
      "rotulo": "QUESTÃO 1",
      "enunciado": "Observe o esquema da classificação POP-Q.\n[Imagem: Aa 0, Ba +2, C 0, HG 4, CP 1, CVT 8, Ap 0, Bp +1, D -2]\nPara ele:",
      "perguntas": [
        {
          "rotulo": "a",
          "texto": "dê o diagnóstico (estádio);",
          "tipo": "discursiva",
          "resposta_esperada": "Prolapso de parede anterior e posterior — estádio 3.",
          "pontos_chave": [
            "Paredes anterior e posterior",
            "Estádio 3"
          ]
        },
        {
          "rotulo": "b",
          "texto": "sugira o tratamento cirúrgico (se houver);",
          "tipo": "discursiva",
          "resposta_esperada": "Colporrafia anterior com fixação da fáscia pubovesicocervical e colporrafia posterior com correção da fáscia retovaginal; histeropexia.",
          "pontos_chave": [
            "Colporrafia anterior",
            "Colporrafia posterior",
            "Histeropexia"
          ]
        },
        {
          "rotulo": "c",
          "texto": "faça a correspondência (se possível) com a classificação de Baden e Walker.",
          "tipo": "discursiva",
          "resposta_esperada": "Grau 3.",
          "pontos_chave": [
            "Grau 3 de Baden-Walker"
          ]
        }
      ],
      "tem_imagem": true,
      "descricao_imagem": "Esquema POP-Q (grade 3×3) com os valores dos pontos.",
      "dificuldade": "dificil",
      "pagina": 2
    }
  ]
}
\`\`\``

/* ------------------------------ Manual ------------------------------ */

function ManualPanel({ visibility, onDone }: { visibility: Visibility; onDone: (s: ReviewState) => void }) {
  const [area, setArea] = useState('Medicina')
  const [discipline, setDiscipline] = useState('Ginecologia')
  const [topic, setTopic] = useState('')
  const [list, setList] = useState<DraftQuestion[]>([])
  const [editing, setEditing] = useState<DraftQuestion | null>(null)

  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Área">
          <input className={inputClass} value={area} onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label="Disciplina">
          <input className={inputClass} value={discipline} onChange={(e) => setDiscipline(e.target.value)} />
        </Field>
        <Field label="Assunto">
          <input className={inputClass} value={topic} placeholder="ex.: Prolapso genital" onChange={(e) => setTopic(e.target.value)} />
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
