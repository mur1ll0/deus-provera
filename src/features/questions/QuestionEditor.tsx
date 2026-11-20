import clsx from 'clsx'
import { CheckCircle2, Circle, ImageIcon, ListPlus, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { QuestionItem } from '@shared/domain'
import { Badge, Button, DemoTag, Field, inputClass, Modal, Segmented } from '@/components/ui'
import { LETTERS } from '@/lib/format'
import { aiGenerateDistractors } from '@/mocks/ai'
import { emptyItem, uid, type DraftQuestion } from '@/mocks/model'

/**
 * Editor de questão: ENUNCIADO + 1..N PERGUNTAS.
 * Cada pergunta tem a sua resposta: discursiva (resposta esperada + pontos-chave)
 * e/ou múltipla escolha (alternativas informadas ou geradas por IA).
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
  const set = <K extends keyof DraftQuestion>(k: K, v: DraftQuestion[K]) => setQ((s) => ({ ...s, [k]: v }))
  const setItem = (id: string, patch: Partial<QuestionItem>) => setQ((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }))

  const multi = q.items.length > 1
  const errors = [...extraErrors, ...validate(q)]

  function addItem() {
    setQ((s) => {
      // Ao virar "várias perguntas", rotula todas em sequência (a, b, c…).
      const items = [...s.items, emptyItem()]
      return { ...s, items: items.map((it, i) => ({ ...it, label: it.label ?? String.fromCharCode(97 + i) })) }
    })
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
      wide
      footer={
        <>
          {(serverError || errors.length > 0) && (
            <span role="alert" className="mr-auto self-center text-xs font-bold text-rose-600">
              {serverError ?? errors[0]}
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
      <div className="space-y-4">
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
          hint={multi ? 'Caso clínico / texto-base comum a todas as perguntas abaixo.' : 'Texto completo da questão (inclusive o comando, ex.: "Qual a conduta?").'}
        >
          <textarea className={clsx(inputClass, 'min-h-28')} value={q.stem} onChange={(e) => set('stem', e.target.value)} />
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

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">{multi ? `Perguntas (${q.items.length})` : 'Resposta'}</span>
            <Button size="sm" variant="secondary" onClick={addItem}>
              <ListPlus size={14} /> Adicionar pergunta
            </Button>
          </div>
          {q.items.map((it, i) => (
            <ItemEditor key={it.id} item={it} index={i} multi={multi} onChange={(p) => setItem(it.id, p)} onRemove={multi ? () => removeItem(it.id) : undefined} />
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={q.visibility === 'publica'}
            onChange={(e) => set('visibility', e.target.checked ? 'publica' : 'privada')}
          />
          Compartilhar esta questão com a comunidade
        </label>
      </div>
    </Modal>
  )
}

function ItemEditor({
  item,
  index,
  multi,
  onChange,
  onRemove,
}: {
  item: QuestionItem
  index: number
  multi: boolean
  onChange: (p: Partial<QuestionItem>) => void
  onRemove?: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const alts = item.alternatives ?? []
  const correctText = alts.find((a) => a.correct)?.text
  const canGenerate = Boolean(item.expectedAnswer?.trim() || correctText?.trim())

  async function generate() {
    setGenerating(true)
    const generated = await aiGenerateDistractors({ expectedAnswer: item.expectedAnswer || correctText, keyPoints: item.keyPoints, prompt: item.prompt })
    // Se o usuário já escreveu a correta, preserva-a e usa só os distratores gerados.
    onChange({ alternatives: correctText?.trim() ? [alts.find((a) => a.correct)!, ...generated.filter((g) => !g.correct)] : generated })
    setGenerating(false)
  }

  const setAlts = (next: typeof alts) => onChange({ alternatives: next })

  return (
    <div className="rounded-2xl border border-line bg-slate-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {multi && (
          <input
            className="w-14 rounded-lg border border-line bg-white px-2 py-1 text-center font-display text-sm font-bold"
            value={item.label ?? ''}
            placeholder={String.fromCharCode(97 + index)}
            onChange={(e) => onChange({ label: e.target.value.slice(0, 4) || undefined })}
            aria-label="Rótulo da pergunta"
          />
        )}
        <Segmented
          value={item.type}
          onChange={(v) => onChange({ type: v })}
          options={[
            { value: 'discursiva', label: 'Discursiva' },
            { value: 'objetiva', label: 'Múltipla escolha' },
          ]}
        />
        {onRemove && (
          <button className="ml-auto rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600" onClick={onRemove} aria-label="Remover pergunta">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {multi && (
        <Field label="Pergunta">
          <textarea className={clsx(inputClass, 'min-h-16')} value={item.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
        </Field>
      )}

      <div className="mt-3">
        <Field label={item.type === 'discursiva' ? 'Resposta esperada' : 'Comentário do gabarito (opcional)'}>
          <textarea className={clsx(inputClass, 'min-h-20')} value={item.expectedAnswer ?? ''} onChange={(e) => onChange({ expectedAnswer: e.target.value })} />
        </Field>
      </div>

      {item.type === 'discursiva' && (
        <div className="mt-3">
          <Field label="Pontos de acerto (um por linha)" hint="Usados para corrigir a resposta escrita: checklist de autocorreção e correção por IA.">
            <textarea
              className={clsx(inputClass, 'min-h-16')}
              value={(item.keyPoints ?? []).join('\n')}
              onChange={(e) => onChange({ keyPoints: e.target.value.split('\n') })}
            />
          </Field>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">
            Alternativas {item.type === 'discursiva' && '(opcional — permite responder como múltipla escolha)'}
          </span>
          <Button size="sm" variant="gold" disabled={!canGenerate || generating} onClick={generate} title={canGenerate ? '' : 'Informe a resposta esperada ou a alternativa correta primeiro'}>
            <Sparkles size={14} /> {generating ? 'Gerando…' : alts.length ? 'Regerar com IA' : 'Gerar com IA'} <DemoTag />
          </Button>
        </div>
        <ul className="space-y-2">
          {alts.map((a, i) => (
            <li key={a.id} className={clsx('flex items-start gap-2 rounded-xl border p-2', a.correct ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-white')}>
              <button
                className={clsx('mt-1.5 shrink-0', a.correct ? 'text-emerald-600' : 'text-slate-300 hover:text-emerald-500')}
                onClick={() => setAlts(alts.map((x) => ({ ...x, correct: x.id === a.id })))}
                title="Marcar como correta"
                aria-label={`Marcar alternativa ${LETTERS[i]} como correta`}
              >
                {a.correct ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </button>
              <span className="mt-1.5 w-4 font-display text-sm font-bold text-muted">{LETTERS[i]}</span>
              <div className="flex-1 space-y-1">
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
              <button className="mt-1.5 text-slate-400 hover:text-rose-600" onClick={() => setAlts(alts.filter((x) => x.id !== a.id))} aria-label="Remover alternativa">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {alts.length < 6 && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAlts([...alts, { id: uid('alt'), text: '', correct: alts.length === 0, source: 'usuario' }])}>
            <Plus size={14} /> Adicionar alternativa
          </Button>
        )}
      </div>
    </div>
  )
}

function validate(q: DraftQuestion): string[] {
  const errors: string[] = []
  if (q.stem.trim().length < 5) errors.push('Escreva o enunciado.')
  if (!q.items.length) errors.push('A questão precisa de pelo menos uma pergunta.')
  q.items.forEach((it, i) => {
    const name = q.items.length > 1 ? `Pergunta ${it.label ?? i + 1}` : 'Resposta'
    const alts = (it.alternatives ?? []).filter((a) => a.text.trim())
    if (q.items.length > 1 && !it.prompt.trim()) errors.push(`${name}: escreva o texto da pergunta.`)
    if (it.type === 'objetiva' && alts.length < 2) errors.push(`${name}: múltipla escolha precisa de ao menos 2 alternativas.`)
    if (alts.length && alts.filter((a) => a.correct).length !== 1) errors.push(`${name}: marque exatamente 1 alternativa correta.`)
    if (it.type === 'discursiva' && !it.expectedAnswer?.trim()) errors.push(`${name}: informe a resposta esperada.`)
  })
  return errors
}
