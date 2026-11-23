import clsx from 'clsx'
import { CheckCircle2, ListChecks, PenLine, Sparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Question, QuestionItem } from '@shared/domain'
import { needsDiscursive, needsMultipleChoice } from '@shared/completeness'
import { Badge, Button, DemoTag, Modal } from '@/components/ui'
import { RichText } from '@/components/RichText'
import { runAiBatches, useDistractors, useWrittenAnswers } from '@/lib/ai'
import { LETTERS } from '@/lib/format'
import { itemLabelText } from '@shared/item-label'
import type { DraftQuestion } from '@/mocks/model'
import { QuestionEditor } from './QuestionEditor'

export type MissingKind = 'multipla' | 'discursiva'

const BATCH = 6

interface Entry {
  question: Question
  draft: DraftQuestion
  /** Perguntas completadas pela IA nesta questão. */
  generated: string[]
  include: boolean
  saved?: boolean
  error?: string
}

/**
 * Completa em lote o formato que falta nas questões do usuário (spec 002 › FR-R8):
 * gera com IA (lotes de 6 perguntas = 1 requisição), mostra tudo para revisar/editar e só então salva.
 */
export function CompleteFormatsDialog({
  kind,
  questions,
  onClose,
  save,
  onSaved,
}: {
  kind: MissingKind
  questions: Question[]
  onClose: () => void
  /** PUT /api/questions/:id com a questão completa. */
  save: (q: Question, draft: DraftQuestion) => Promise<unknown>
  onSaved: () => void
}) {
  const distractors = useDistractors()
  const written = useWrittenAnswers()
  const demo = kind === 'multipla' ? distractors.demo : written.demo
  const [phase, setPhase] = useState<'confirm' | 'running' | 'review' | 'saving' | 'done'>('confirm')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [entries, setEntries] = useState<Entry[]>([])
  const [runError, setRunError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const abort = useRef<AbortController | null>(null)

  const needs = kind === 'multipla' ? needsMultipleChoice : needsDiscursive
  const items = useMemo(() => questions.flatMap((q) => q.items.filter(needs).map((it) => ({ q, it }))), [questions, needs])
  const requests = Math.ceil(items.length / BATCH)
  const what = kind === 'multipla' ? 'múltipla escolha' : 'resposta discursiva'

  async function generate() {
    setPhase('running')
    setRunError(null)
    abort.current = new AbortController()
    const onProgress = (done: number, total: number) => setProgress({ done, total })
    const patches = new Map<string, Partial<QuestionItem>>()
    let error: string | undefined
    if (kind === 'multipla') {
      const reqs = items.map(({ q, it }) => ({ id: it.id, stem: (q.stem || it.prompt || '—').slice(0, 8000), prompt: it.prompt?.slice(0, 4000), expectedAnswer: it.expectedAnswer!.trim().slice(0, 4000) }))
      const r = await runAiBatches(reqs, distractors.generate, { onProgress, signal: abort.current.signal })
      for (const [id, alternatives] of r.out) patches.set(id, { alternatives })
      error = r.error
    } else {
      const reqs = items.map(({ q, it }) => ({
        id: it.id,
        stem: (q.stem || it.prompt || '—').slice(0, 8000),
        prompt: it.prompt?.slice(0, 4000),
        alternatives: (it.alternatives ?? []).map((a) => ({ text: a.text.slice(0, 1500), correct: a.correct, explanation: a.explanation?.slice(0, 2000) })),
      }))
      const r = await runAiBatches(reqs, written.generate, { onProgress, signal: abort.current.signal })
      for (const [id, w] of r.out) patches.set(id, { expectedAnswer: w.expectedAnswer, keyPoints: w.keyPoints })
      error = r.error
    }
    const next: Entry[] = questions
      .map((q) => {
        const generated = q.items.filter((it) => patches.has(it.id)).map((it) => it.id)
        return { question: q, draft: { ...q, items: q.items.map((it) => ({ ...it, ...patches.get(it.id) })) }, generated, include: true }
      })
      .filter((e) => e.generated.length > 0)
    setEntries(next)
    if (error) setRunError(`${error}${patches.size < items.length ? ` ${items.length - patches.size} pergunta(s) ficaram sem ${what}.` : ''}`)
    setPhase(next.length ? 'review' : 'confirm')
  }

  async function saveAll() {
    setPhase('saving')
    const todo = entries.filter((e) => e.include && !e.saved)
    let i = 0
    const results = new Map<string, { saved: boolean; error?: string }>()
    async function worker() {
      while (i < todo.length) {
        const e = todo[i++]
        try {
          await save(e.question, e.draft)
          results.set(e.question.id, { saved: true })
        } catch (err) {
          results.set(e.question.id, { saved: false, error: (err as Error).message || 'Erro ao salvar.' })
        }
        setProgress({ done: results.size, total: todo.length })
      }
    }
    setProgress({ done: 0, total: todo.length })
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker))
    const next = entries.map((e) => (results.has(e.question.id) ? { ...e, ...results.get(e.question.id) } : e))
    setEntries(next)
    onSaved()
    setPhase(next.some((e) => e.include && !e.saved) ? 'review' : 'done')
  }

  const pending = entries.filter((e) => e.include && !e.saved)
  const savedCount = entries.filter((e) => e.saved).length

  if (editing)
    return (
      <QuestionEditor
        open
        title="Revisar questão gerada"
        initial={editing.draft}
        onClose={() => setEditing(null)}
        onSave={(d) => {
          setEntries((es) => es.map((e) => (e.question.id === editing.question.id ? { ...e, draft: d, include: true } : e)))
          setEditing(null)
        }}
      />
    )

  return (
    <Modal
      open
      wide
      onClose={phase === 'running' || phase === 'saving' ? () => abort.current?.abort() : onClose}
      title={kind === 'multipla' ? 'Gerar múltipla escolha com IA' : 'Gerar respostas discursivas com IA'}
      footer={
        phase === 'confirm' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="gold" disabled={!items.length} onClick={() => void generate()}>
              <Sparkles size={16} /> Gerar para {items.length} {items.length === 1 ? 'pergunta' : 'perguntas'} {demo && <DemoTag />}
            </Button>
          </>
        ) : phase === 'running' ? (
          <Button variant="secondary" onClick={() => abort.current?.abort()}>
            Parar (mantém o que já foi gerado)
          </Button>
        ) : phase === 'review' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Descartar
            </Button>
            <Button disabled={!pending.length} onClick={() => void saveAll()}>
              <CheckCircle2 size={16} /> Salvar {pending.length} {pending.length === 1 ? 'questão' : 'questões'}
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : null
      }
    >
      {phase === 'confirm' && (
        <div className="space-y-3 text-sm">
          <p>
            <b>{questions.length}</b> {questions.length === 1 ? 'questão sua tem' : 'questões suas têm'} <b>{items.length}</b> {items.length === 1 ? 'pergunta' : 'perguntas'} sem {what}.
          </p>
          <p className="text-muted">
            {kind === 'multipla'
              ? 'A IA cria 1 alternativa correta (síntese da resposta esperada) e 4 incorretas plausíveis, cada uma com explicação.'
              : 'A IA escreve a resposta a partir da alternativa correta e do comentário do gabarito, e os pontos de acerto para a correção.'}{' '}
            Nada é salvo antes da sua revisão.
          </p>
          <p className="rounded-xl bg-gold-50 p-3 text-xs">
            Usa cerca de <b>{requests}</b> {requests === 1 ? 'requisição' : 'requisições'} da sua cota diária de IA (6 perguntas por requisição).
          </p>
          {runError && (
            <p role="alert" className="text-xs font-bold text-rose-600">
              {runError}
            </p>
          )}
        </div>
      )}

      {(phase === 'running' || phase === 'saving') && (
        <div className="space-y-3 py-4 text-center text-sm" aria-live="polite">
          <p className="font-bold">
            {phase === 'running' ? `Gerando ${what}…` : 'Salvando…'} {progress.done} de {progress.total}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-brand-50">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          {phase === 'running' && <p className="text-xs text-muted">Pode levar alguns minutos: os modelos gratuitos respondem devagar.</p>}
        </div>
      )}

      {(phase === 'review' || phase === 'done') && (
        <div className="space-y-3">
          {runError && (
            <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
              {runError}
            </p>
          )}
          {phase === 'done' ? (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
              {savedCount} {savedCount === 1 ? 'questão salva' : 'questões salvas'} com {what}.
            </p>
          ) : (
            <p className="text-sm text-muted">Confira o que a IA gerou. Desmarque o que não quiser salvar ou abra a questão para ajustar.</p>
          )}
          <ul className="space-y-3">
            {entries.map((e) => (
              <li key={e.question.id} className={clsx('rounded-2xl border p-3', e.saved ? 'border-emerald-200 bg-emerald-50/50' : e.include ? 'border-brand-200 bg-white' : 'border-line bg-slate-50 opacity-70')}>
                <div className="flex items-start gap-2">
                  {e.saved ? (
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Salva" />
                  ) : (
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-brand-600"
                      checked={e.include}
                      disabled={phase !== 'review'}
                      onChange={(ev) => setEntries((es) => es.map((x) => (x.question.id === e.question.id ? { ...x, include: ev.target.checked } : x)))}
                      aria-label="Salvar esta questão"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap gap-1">
                      {e.question.sourceLabel && <Badge tone="neutral">{e.question.sourceLabel}</Badge>}
                      {e.question.topic && <Badge tone="brand">{e.question.topic}</Badge>}
                    </div>
                    <p className="line-clamp-2 text-sm">{e.question.stem}</p>
                  </div>
                  {phase === 'review' && !e.saved && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(e)}>
                      Revisar
                    </Button>
                  )}
                </div>
                {e.error && (
                  <p role="alert" className="mt-2 text-xs font-bold text-rose-600">
                    Não salvou: {e.error}
                  </p>
                )}
                <div className="mt-2 space-y-2">
                  {e.draft.items
                    .filter((it) => e.generated.includes(it.id))
                    .map((it) => (
                      <GeneratedItem key={it.id} item={it} kind={kind} multi={e.draft.items.length > 1} />
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

function GeneratedItem({ item, kind, multi }: { item: QuestionItem; kind: MissingKind; multi: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-slate-50/70 p-2.5 text-sm">
      {multi && (
        <p className="mb-1 text-xs">
          <b>{itemLabelText(item.label)}</b> {item.prompt}
        </p>
      )}
      {kind === 'multipla' ? (
        <>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
            <ListChecks size={12} /> Alternativas geradas
          </p>
          <ul className="space-y-1">
            {(item.alternatives ?? []).map((a, i) => (
              <li key={a.id} className={clsx('rounded-lg px-2 py-1 text-xs', a.correct ? 'bg-emerald-100 font-bold text-emerald-900' : 'bg-white')}>
                {LETTERS[i]}) {a.text}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
            <PenLine size={12} /> Resposta escrita gerada
          </p>
          <RichText text={item.expectedAnswer ?? ''} className="text-xs" />
          {!!item.keyPoints?.length && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted">
              {item.keyPoints.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

