import clsx from 'clsx'
import { AlertCircle, CheckCircle2, ChevronDown, Circle, ImageIcon, ListChecks, PenLine, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { QuestionItem } from '@shared/domain'
import { QUESTION_LIMITS } from '@shared/schemas/question'
import { hasValidAlternatives } from '@shared/simulado'
import { Badge, Button, DemoTag, Field, inputClass, Modal, Segmented } from '@/components/ui'
import { LETTERS } from '@/lib/format'
import { useDistractors, useWrittenAnswers } from '@/lib/ai'
import { emptyItem, uid, type DraftQuestion } from '@/mocks/model'

/**
 * Editor de questão: ENUNCIADO + 1..N PERGUNTAS.
 * No desktop, duas colunas: o enunciado fica fixo à esquerda e a lista de perguntas, à direita
 * (cada pergunta é um card numerado, recolhível, com a sua resposta escrita e/ou alternativas).
 */
export function QuestionEditor({
  open,
  initial,
  title = 'Editar questão',
  onClose,
  onSave,
  header,
  extraErrors = [],
  saving = false,
  serverError,
}: {
  open: boolean
  initial: DraftQuestion
  title?: string
  onClose: () => void
  onSave: (q: DraftQuestion) => void
  /** Conteúdo extra no topo (ex.: Área › Disciplina › Assunto no banco de questões). */
  header?: ReactNode
  /** Erros de campos fora do editor (bloqueiam o salvar). */
  extraErrors?: string[]
  /** Salvando no servidor: desabilita o botão. */
  saving?: boolean
  /** Erro devolvido pela API ao salvar. */
  serverError?: string | null
}) {
  const [q, setQ] = useState<DraftQuestion>(initial)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial.items.length <= 3 ? initial.items.map((i) => i.id) : [initial.items[0]?.id]))
  const set = <K extends keyof DraftQuestion>(k: K, v: DraftQuestion[K]) => setQ((s) => ({ ...s, [k]: v }))
  const setItem = (id: string, patch: Partial<QuestionItem>) => setQ((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }))

  const multi = q.items.length > 1
  const itemErrors = new Map(q.items.map((it, i) => [it.id, validateItem(it, i, multi)]))
  const errors = [...extraErrors, ...validateQuestion(q), ...[...itemErrors.values()].flat()]

  function focusItem(id: string) {
    setExpanded((s) => new Set(s).add(id))
    // Espera o card abrir antes de rolar.
    requestAnimationFrame(() => document.getElementById(`pergunta-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function addItem() {
    const item = emptyItem()
    setQ((s) => {
      // Ao virar "várias perguntas", rotula todas em sequência (a, b, c…).
      const items = [...s.items, item]
      return { ...s, items: items.map((it, i) => ({ ...it, label: it.label ?? String.fromCharCode(97 + i) })) }
    })
    focusItem(item.id)
  }

  function removeItem(id: string) {
    setQ((s) => {
      const items = s.items.filter((it) => it.id !== id)
      return { ...s, items: items.length === 1 && !items[0].prompt ? [{ ...items[0], label: undefined }] : items }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      xl
      footer={
        <>
          {(serverError || errors.length > 0) && (
            <span role="alert" className="mr-auto self-center text-xs font-bold text-rose-600">
              {serverError ?? errors[0]}
              {!serverError && errors.length > 1 && <span className="font-normal text-muted"> (+{errors.length - 1})</span>}
            </span>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={errors.length > 0 || saving}
            onClick={() =>
              onSave({
                ...q,
                items: q.items.map((it) => ({
                  ...it,
                  alternatives: it.alternatives?.filter((a) => a.text.trim()),
                  keyPoints: it.keyPoints?.map((k) => k.trim()).filter(Boolean),
                })),
              })
            }
          >
            {saving ? 'Salvando…' : 'Salvar questão'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Coluna 1 — classificação e ENUNCIADO (fixa no desktop enquanto as perguntas rolam) */}
        <section aria-label="Enunciado" className="scrollbar-thin space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(92vh-10rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {header}
          {q.flags && q.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.flags.map((f) => (
                <Badge key={f} tone={f.startsWith('Guardrail') ? 'red' : 'gold'}>
                  {f}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={q.difficulty}
              onChange={(v) => set('difficulty', v)}
              options={[
                { value: 'facil', label: 'Fácil' },
                { value: 'media', label: 'Média' },
                { value: 'dificil', label: 'Difícil' },
              ]}
            />
            {q.sourceLabel && <Badge tone="neutral">{q.sourceLabel}</Badge>}
          </div>

          <Field
            label="Enunciado"
            hint={multi ? 'Caso clínico / texto-base comum a todas as perguntas da lista.' : 'Texto completo da questão (inclusive o comando, ex.: "Qual a conduta?").'}
          >
            <textarea className={clsx(inputClass, 'min-h-36 lg:min-h-64')} value={q.stem} onChange={(e) => set('stem', e.target.value)} />
          </Field>

          {q.hasImage && (
            <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
              <ImageIcon size={18} className="mt-0.5 shrink-0 text-sky-600" />
              <div className="w-full">
                <p className="font-bold text-sky-800">Questão com imagem</p>
                <textarea
                  className={clsx(inputClass, 'mt-1 min-h-14')}
                  placeholder="Descrição da imagem (gerada pelo modelo de visão)"
                  value={q.imageDescription ?? ''}
                  onChange={(e) => set('imageDescription', e.target.value)}
                />
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={q.visibility === 'publica'}
              onChange={(e) => set('visibility', e.target.checked ? 'publica' : 'privada')}
            />
            Compartilhar esta questão com a comunidade
          </label>
        </section>

        {/* Coluna 2 — LISTA DE PERGUNTAS */}
        <section aria-labelledby="perguntas-titulo" className="min-w-0 rounded-2xl border-2 border-brand-100 bg-brand-50/50 p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ListChecks size={18} className="text-brand-600" />
            <h4 id="perguntas-titulo" className="font-display text-base font-bold">
              Perguntas da questão
            </h4>
            <Badge tone="brand">{q.items.length}</Badge>
            <span className="basis-full text-xs text-muted">Cada pergunta tem a sua resposta: escrita (discursiva) e/ou alternativas (múltipla escolha).</span>
          </div>

          {multi && (
            <nav aria-label="Ir para a pergunta" className="mb-3 flex flex-wrap gap-1.5">
              {q.items.map((it, i) => {
                const bad = (itemErrors.get(it.id) ?? []).length > 0
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => focusItem(it.id)}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 font-display text-xs font-bold transition hover:border-brand-400',
                      bad ? 'border-rose-300 text-rose-700' : 'border-line text-ink',
                    )}
                  >
                    {bad ? <AlertCircle size={12} /> : <CheckCircle2 size={12} className="text-emerald-600" />}
                    {it.label || i + 1}
                  </button>
                )
              })}
            </nav>
          )}

          <div className="space-y-3">
            {q.items.map((it, i) => (
              <ItemCard
                key={it.id}
                item={it}
                index={i}
                multi={multi}
                stem={q.stem}
                open={expanded.has(it.id)}
                errors={itemErrors.get(it.id) ?? []}
                onToggle={() => toggle(it.id)}
                onChange={(p) => setItem(it.id, p)}
                onRemove={multi ? () => removeItem(it.id) : undefined}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-white/70 px-4 py-3 font-display text-sm font-bold text-brand-700 transition hover:border-brand-400 hover:bg-white"
          >
            <Plus size={16} /> Adicionar pergunta
          </button>
        </section>
      </div>
    </Modal>
  )
}

function ItemCard({
  item,
  index,
  multi,
  stem,
  open,
  errors,
  onToggle,
  onChange,
  onRemove,
}: {
  item: QuestionItem
  index: number
  multi: boolean
  stem: string
  open: boolean
  errors: string[]
  onToggle: () => void
  onChange: (p: Partial<QuestionItem>) => void
  onRemove?: () => void
}) {
  const hasWritten = !!item.expectedAnswer?.trim()
  const hasMc = hasValidAlternatives(item)
  const label = item.label || String(index + 1)
  return (
    <article id={`pergunta-${item.id}`} className={clsx('scroll-mt-2 overflow-hidden rounded-2xl border bg-white shadow-sm', errors.length ? 'border-rose-300' : 'border-line')}>
      <header className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-sm font-bold text-white">{multi ? label : <PenLine size={14} />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{multi ? `Pergunta ${label}` : 'Pergunta única · resposta'}</span>
            <span className={clsx('block truncate text-sm', !item.prompt && 'text-muted')}>{multi ? item.prompt || 'Sem texto ainda' : 'O enunciado já é a pergunta'}</span>
          </span>
        </button>
        <span className="hidden shrink-0 gap-1 sm:flex">
          <Badge tone={hasWritten ? 'green' : 'neutral'}>
            <PenLine size={11} /> escrita
          </Badge>
          <Badge tone={hasMc ? 'green' : 'neutral'}>
            <ListChecks size={11} /> alternativas
          </Badge>
        </span>
        {onRemove && (
          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600" onClick={onRemove} aria-label={`Remover pergunta ${label}`}>
            <Trash2 size={16} />
          </button>
        )}
        <button type="button" onClick={onToggle} className="rounded-lg p-1.5 text-muted hover:bg-brand-50" aria-label={open ? 'Recolher pergunta' : 'Abrir pergunta'}>
          <ChevronDown size={16} className={clsx('transition', open && 'rotate-180')} />
        </button>
      </header>
      {open && <ItemBody item={item} index={index} multi={multi} stem={stem} errors={errors} onChange={onChange} />}
    </article>
  )
}

function ItemBody({
  item,
  index,
  multi,
  stem,
  errors,
  onChange,
}: {
  item: QuestionItem
  index: number
  multi: boolean
  stem: string
  errors: string[]
  onChange: (p: Partial<QuestionItem>) => void
}) {
  const [busy, setBusy] = useState<'alts' | 'written' | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const distractors = useDistractors()
  const written = useWrittenAnswers()
  const alts = item.alternatives ?? []
  const correctText = alts.find((a) => a.correct)?.text
  const canGenerateAlts = Boolean(item.expectedAnswer?.trim() || correctText?.trim())
  const canGenerateWritten = hasValidAlternatives(item)
  const objetiva = item.type === 'objetiva'

  async function run(kind: 'alts' | 'written', fn: () => Promise<boolean>) {
    setBusy(kind)
    setGenError(null)
    try {
      if (!(await fn())) setGenError('A IA não devolveu resultado. Tente de novo.')
    } catch (err) {
      setGenError((err as Error).message || 'IA indisponível agora.')
    } finally {
      setBusy(null)
    }
  }

  const generateAlts = () =>
    run('alts', async () => {
      // Se o usuário já escreveu a correta, ela é preservada (o servidor gera só os distratores).
      const out = await distractors.generate([
        { id: item.id, stem: stem || item.prompt || '—', prompt: item.prompt, expectedAnswer: (item.expectedAnswer || correctText || '').trim(), correct: correctText?.trim() || undefined },
      ])
      const generated = out.get(item.id)
      if (generated?.length) onChange({ alternatives: generated })
      return !!generated?.length
    })

  const generateWritten = () =>
    run('written', async () => {
      const out = await written.generate([
        { id: item.id, stem: stem || item.prompt || '—', prompt: item.prompt, alternatives: alts.filter((a) => a.text.trim()).map((a) => ({ text: a.text, correct: a.correct, explanation: a.explanation })) },
      ])
      const r = out.get(item.id)
      if (r) onChange({ expectedAnswer: r.expectedAnswer, keyPoints: r.keyPoints })
      return !!r
    })

  const setAlts = (next: typeof alts) => onChange({ alternatives: next })

  const writtenBlock = (
    <SubSection
      icon={<PenLine size={14} />}
      title={objetiva ? 'Resposta escrita' : 'Resposta esperada'}
      hint={objetiva ? 'Opcional — permite responder escrevendo (simulado discursivo).' : 'Usada na correção da resposta escrita.'}
      action={
        objetiva && (
          <Button size="sm" variant="gold" disabled={!canGenerateWritten || busy !== null} onClick={generateWritten} title={canGenerateWritten ? '' : 'Marque a alternativa correta primeiro'}>
            <Sparkles size={14} /> {busy === 'written' ? 'Gerando…' : item.expectedAnswer?.trim() ? 'Regerar com IA' : 'Gerar com IA'} {written.demo && <DemoTag />}
          </Button>
        )
      }
    >
      <textarea className={clsx(inputClass, 'min-h-20')} aria-label="Resposta esperada" value={item.expectedAnswer ?? ''} onChange={(e) => onChange({ expectedAnswer: e.target.value })} />
      <Field label="Pontos de acerto (um por linha)" hint="Checklist de autocorreção e correção por IA.">
        <textarea className={clsx(inputClass, 'min-h-16')} value={(item.keyPoints ?? []).join('\n')} onChange={(e) => onChange({ keyPoints: e.target.value.split('\n') })} />
      </Field>
    </SubSection>
  )

  const altsBlock = (
    <SubSection
      icon={<ListChecks size={14} />}
      title="Alternativas"
      hint={objetiva ? 'Marque a correta.' : 'Opcional — permite responder como múltipla escolha.'}
      action={
        <Button size="sm" variant="gold" disabled={!canGenerateAlts || busy !== null} onClick={generateAlts} title={canGenerateAlts ? '' : 'Informe a resposta esperada ou a alternativa correta primeiro'}>
          <Sparkles size={14} /> {busy === 'alts' ? 'Gerando…' : alts.length ? 'Regerar com IA' : 'Gerar com IA'} {distractors.demo && <DemoTag />}
        </Button>
      }
    >
      <ul className="space-y-2">
        {alts.map((a, i) => (
          <li key={a.id} className={clsx('flex items-start gap-2 rounded-xl border p-2', a.correct ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-white')}>
            <button
              type="button"
              className={clsx('mt-1.5 shrink-0', a.correct ? 'text-emerald-600' : 'text-slate-300 hover:text-emerald-500')}
              onClick={() => setAlts(alts.map((x) => ({ ...x, correct: x.id === a.id })))}
              title="Marcar como correta"
              aria-label={`Marcar alternativa ${LETTERS[i]} como correta`}
            >
              {a.correct ? <CheckCircle2 size={20} /> : <Circle size={20} />}
            </button>
            <span className="mt-1.5 w-4 font-display text-sm font-bold text-muted">{LETTERS[i]}</span>
            <div className="min-w-0 flex-1 space-y-1">
              <input
                className={inputClass}
                value={a.text}
                placeholder={a.correct ? 'Alternativa correta' : 'Alternativa incorreta'}
                onChange={(e) => setAlts(alts.map((x) => (x.id === a.id ? { ...x, text: e.target.value, source: 'usuario' } : x)))}
              />
              <input
                className={clsx(inputClass, 'text-xs')}
                value={a.explanation ?? ''}
                placeholder="Por que está certa/errada? (opcional — a IA pode gerar)"
                onChange={(e) => setAlts(alts.map((x) => (x.id === a.id ? { ...x, explanation: e.target.value } : x)))}
              />
            </div>
            {a.source === 'ia' && <Badge tone="gold">IA</Badge>}
            <button type="button" className="mt-1.5 text-slate-400 hover:text-rose-600" onClick={() => setAlts(alts.filter((x) => x.id !== a.id))} aria-label="Remover alternativa">
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      {alts.length < 6 && (
        <Button size="sm" variant="ghost" onClick={() => setAlts([...alts, { id: uid('alt'), text: '', correct: alts.length === 0, source: 'usuario' }])}>
          <Plus size={14} /> Adicionar alternativa
        </Button>
      )}
    </SubSection>
  )

  return (
    <div className="space-y-4 border-t border-line bg-slate-50/50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {multi && (
          <label className="flex items-center gap-1.5 text-xs font-bold text-muted">
            Rótulo
            <input
              className="w-14 min-w-14 rounded-lg border border-line bg-white px-2 py-1 text-center font-display text-sm font-bold text-ink [field-sizing:content]"
              value={item.label ?? ''}
              placeholder={String.fromCharCode(97 + index)}
              maxLength={QUESTION_LIMITS.label}
              onChange={(e) => onChange({ label: e.target.value.slice(0, QUESTION_LIMITS.label) || undefined })}
            />
          </label>
        )}
        <span className="text-xs font-bold text-muted">Formato original:</span>
        <Segmented
          value={item.type}
          onChange={(v) => onChange({ type: v })}
          options={[
            { value: 'discursiva', label: 'Discursiva' },
            { value: 'objetiva', label: 'Múltipla escolha' },
          ]}
        />
      </div>

      {multi && (
        <Field label="Texto da pergunta">
          <textarea className={clsx(inputClass, 'min-h-16')} value={item.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
        </Field>
      )}

      {genError && (
        <p role="alert" className="text-xs text-rose-600">
          {genError}
        </p>
      )}

      {/* O formato original vem primeiro; o outro é o complemento opcional. */}
      {objetiva ? (
        <>
          {altsBlock}
          {writtenBlock}
        </>
      ) : (
        <>
          {writtenBlock}
          {altsBlock}
        </>
      )}

      {errors.length > 0 && (
        <ul className="space-y-0.5 rounded-xl bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
          {errors.map((e) => (
            <li key={e} className="flex gap-1.5">
              <AlertCircle size={13} className="mt-0.5 shrink-0" /> {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SubSection({ icon, title, hint, action, children }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-brand-600">{icon}</span>
        <span className="text-xs font-bold uppercase tracking-wide text-ink">{title}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  )
}

function validateQuestion(q: DraftQuestion): string[] {
  const errors: string[] = []
  if (q.stem.trim().length < 5) errors.push('Escreva o enunciado.')
  if (!q.items.length) errors.push('A questão precisa de pelo menos uma pergunta.')
  return errors
}

function validateItem(it: QuestionItem, i: number, multi: boolean): string[] {
  const errors: string[] = []
  const name = multi ? `Pergunta ${it.label ?? i + 1}` : 'Resposta'
  const alts = (it.alternatives ?? []).filter((a) => a.text.trim())
  if (multi && !it.prompt.trim()) errors.push(`${name}: escreva o texto da pergunta.`)
  if (it.type === 'objetiva' && alts.length < 2) errors.push(`${name}: múltipla escolha precisa de ao menos 2 alternativas.`)
  if (alts.length && alts.filter((a) => a.correct).length !== 1) errors.push(`${name}: marque exatamente 1 alternativa correta.`)
  if (it.type === 'discursiva' && !it.expectedAnswer?.trim()) errors.push(`${name}: informe a resposta esperada.`)
  return errors
}
