import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import clsx from 'clsx'
import { AlertTriangle, BookOpen, FolderPlus, GripVertical, Layers, ListChecks, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Card, DemoTag, Field, inputClass, Modal } from '@/components/ui'
import { useDistractors } from '@/lib/ai'
import { uid, type DraftQuestion, type ImportCard } from '@/mocks/model'
import { QuestionEditor } from '@/features/questions/QuestionEditor'
import type { ReviewProblem } from './commit'
import type { ReviewNotes, ReviewState } from './drafts'

/**
 * Tela de revisão pós-processamento: cards por Área › Disciplina · Assunto.
 * O usuário arrasta questões entre cards, edita/cria cards e questões e confirma para salvar.
 */
export function ReviewBoard({
  state,
  onChange,
  onConfirm,
  onBack,
  saving = false,
  problems = [],
  error,
}: {
  state: ReviewState
  onChange: (s: ReviewState) => void
  onConfirm: () => void
  onBack: () => void
  /** Commit em andamento (botão desabilitado). */
  saving?: boolean
  /** Itens que impedem salvar (validação local ou 400 do servidor) — T040. */
  problems?: ReviewProblem[]
  /** Erro geral do salvamento (rede, servidor). */
  error?: string | null
}) {
  const [editingCard, setEditingCard] = useState<ImportCard | null>(null)
  const [editingQ, setEditingQ] = useState<DraftQuestion | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [bulk, setBulk] = useState<'idle' | 'running' | 'done'>('idle')
  const [bulkError, setBulkError] = useState<string | null>(null)
  const ai = useDistractors()
  const problemsRef = useRef<HTMLElement>(null)
  const hasProblems = problems.length > 0 || !!error
  // O aviso fica depois de todos os cards: ao aparecer (tentativa de salvar), rola até ele.
  useEffect(() => {
    if (hasProblems) problemsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [hasProblems])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))

  const { cards, drafts } = state
  const total = cards.reduce((a, c) => a + c.questionIds.length, 0)
  const flagged = Object.values(drafts).filter((d) => d.flags?.length).length
  const perguntasSemAlt = Object.values(drafts).reduce((a, d) => a + d.items.filter((i) => !i.alternatives?.length && i.expectedAnswer).length, 0)

  const cardOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cards) for (const q of c.questionIds) m.set(q, c.id)
    return m
  }, [cards])

  function moveQuestion(qid: string, toCardId: string) {
    const from = cardOf.get(qid)
    if (!from || from === toCardId) return
    onChange({
      ...state,
      cards: cards.map((c) =>
        c.id === from ? { ...c, questionIds: c.questionIds.filter((x) => x !== qid) } : c.id === toCardId ? { ...c, questionIds: [...c.questionIds, qid] } : c,
      ),
    })
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    if (e.over) moveQuestion(String(e.active.id), String(e.over.id))
  }

  function saveCard(card: ImportCard) {
    const exists = cards.some((c) => c.id === card.id)
    onChange({ ...state, cards: exists ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card] })
    setEditingCard(null)
  }

  /** Junta cards da mesma Área › Disciplina (útil quando o agente criou um assunto por questão). */
  function groupByDiscipline() {
    const merged = new Map<string, ImportCard>()
    for (const c of cards) {
      const key = `${c.area}|${c.discipline}`.toLocaleLowerCase('pt-BR')
      const cur = merged.get(key)
      merged.set(key, cur ? { ...cur, topic: '', description: '', questionIds: [...cur.questionIds, ...c.questionIds] } : { ...c })
    }
    onChange({ ...state, cards: [...merged.values()] })
  }

  function removeCard(card: ImportCard) {
    // Questões do card removido vão para o primeiro card restante (nada é perdido sem querer).
    const rest = cards.filter((c) => c.id !== card.id)
    if (!rest.length) return
    rest[0] = { ...rest[0], questionIds: [...rest[0].questionIds, ...card.questionIds] }
    onChange({ ...state, cards: rest })
  }

  function removeQuestion(qid: string) {
    const nextDrafts = { ...drafts }
    delete nextDrafts[qid]
    onChange({ ...state, drafts: nextDrafts, cards: cards.map((c) => ({ ...c, questionIds: c.questionIds.filter((x) => x !== qid) })) })
  }

  /** Distratores para todas as perguntas com resposta esperada e sem alternativas (lotes de 6 = 1 requisição cada). */
  async function generateAllDistractors() {
    setBulk('running')
    setBulkError(null)
    const reqs = Object.values(drafts).flatMap((d) =>
      d.items.filter((it) => !it.alternatives?.length && it.expectedAnswer?.trim()).map((it) => ({ id: it.id, stem: d.stem, prompt: it.prompt, expectedAnswer: it.expectedAnswer!.trim() })),
    )
    try {
      const out = await ai.generate(reqs)
      const next = Object.fromEntries(Object.entries(drafts).map(([k, d]) => [k, { ...d, items: d.items.map((it) => (out.get(it.id) ? { ...it, alternatives: out.get(it.id) } : it)) }]))
      onChange({ ...state, drafts: next })
      setBulk('done')
      if (out.size < reqs.length) setBulkError(`${reqs.length - out.size} pergunta(s) ficaram sem alternativas — tente de novo ou escreva no editor.`)
    } catch (err) {
      setBulk('idle')
      setBulkError((err as Error).message || 'IA indisponível agora.')
    }
  }

  const activeDraft = activeId ? drafts[activeId] : null
  const invalidDrafts = [...new Set(problems.map((p) => p.draftId).filter((id): id is string => !!id && !!drafts[id]))]
  const draftLabel = (id: string) => {
    const d = drafts[id]
    return d?.sourceLabel || (d?.stem ? `“${d.stem.slice(0, 60)}${d.stem.length > 60 ? '…' : ''}”` : 'Questão')
  }
  function removeInvalid() {
    const drop = new Set(invalidDrafts)
    const nextDrafts = Object.fromEntries(Object.entries(drafts).filter(([id]) => !drop.has(id)))
    onChange({ ...state, drafts: nextDrafts, cards: cards.map((c) => ({ ...c, questionIds: c.questionIds.filter((x) => !drop.has(x)) })) })
  }

  return (
    <div className="space-y-5">
      {/* Barra de resumo */}
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex min-w-0 flex-wrap gap-2 text-sm">
          <Badge tone="brand">{total} {total === 1 ? 'questão' : 'questões'}</Badge>
          <Badge tone="neutral">{cards.length} {cards.length === 1 ? 'card' : 'cards'}</Badge>
          {flagged > 0 && (
            <Badge tone="gold">
              <AlertTriangle size={12} /> {flagged} para revisar
            </Badge>
          )}
          {state.fileName && (
            <Badge tone="blue" className="max-w-full min-w-0">
              <span className="truncate" title={state.fileName}>
                {state.fileName}
              </span>
            </Badge>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {perguntasSemAlt > 0 && (
            <Button size="sm" variant="gold" disabled={bulk === 'running'} onClick={generateAllDistractors}>
              <Sparkles size={14} /> {bulk === 'running' ? 'Gerando…' : `Gerar múltipla escolha p/ ${perguntasSemAlt} perguntas`} {ai.demo && <DemoTag />}
            </Button>
          )}
          {cards.length > 6 && cards.length > total / 3 && (
            <Button size="sm" variant="secondary" onClick={groupByDiscipline} title="Muitos cards pequenos: junta os de mesma área e disciplina">
              <Layers size={14} /> Agrupar por disciplina
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setEditingCard({ id: uid('card'), area: cards[0]?.area ?? '', discipline: cards[0]?.discipline ?? '', topic: '', description: '', questionIds: [] })}>
            <FolderPlus size={14} /> Novo card
          </Button>
        </div>
      </Card>

      {state.notes && <DocumentNotes notes={state.notes} />}

      {bulkError && (
        <p role="alert" className="text-sm text-rose-600">
          {bulkError}
        </p>
      )}
      <p className="text-sm text-muted">
        Arraste as questões entre os cards (ou use o seletor <b>Mover para</b>). Edite área, disciplina, assunto e descrição de cada card. Nada é salvo até você confirmar.
      </p>

      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {cards.map((card) => (
            <DropCard key={card.id} card={card} onEdit={() => setEditingCard(card)} onRemove={cards.length > 1 ? () => removeCard(card) : undefined}>
              {card.questionIds.length === 0 && <p className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">Solte questões aqui</p>}
              {card.questionIds.map((qid) =>
                drafts[qid] ? (
                  <DraggableQuestion
                    key={qid}
                    q={drafts[qid]}
                    cards={cards}
                    currentCardId={card.id}
                    onMove={(to) => moveQuestion(qid, to)}
                    onEdit={() => setEditingQ(drafts[qid])}
                    onRemove={() => removeQuestion(qid)}
                  />
                ) : null,
              )}
            </DropCard>
          ))}
        </div>
        <DragOverlay>{activeDraft ? <QuestionChip q={activeDraft} dragging /> : null}</DragOverlay>
      </DndContext>

      {hasProblems && (
        <section ref={problemsRef} role="alert" aria-labelledby="review-problems" className="scroll-mb-40 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <h2 id="review-problems" className="flex items-center gap-2 font-display text-sm font-bold text-rose-700">
            <AlertTriangle size={16} /> {error ?? 'Ajuste estes itens antes de salvar'}
          </h2>
          {problems.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-sm">
              {problems.slice(0, 12).map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1">
                    {p.draftId && <b>{draftLabel(p.draftId)}: </b>}
                    {p.cardId && <b>Card {cards.find((c) => c.id === p.cardId)?.topic || cards.find((c) => c.id === p.cardId)?.discipline}: </b>}
                    {p.message}
                  </span>
                  {p.draftId && drafts[p.draftId] && (
                    <Button size="sm" variant="secondary" onClick={() => setEditingQ(drafts[p.draftId!])}>
                      <Pencil size={13} /> Editar
                    </Button>
                  )}
                  {p.cardId && cards.find((c) => c.id === p.cardId) && (
                    <Button size="sm" variant="secondary" onClick={() => setEditingCard(cards.find((c) => c.id === p.cardId)!)}>
                      <Pencil size={13} /> Editar card
                    </Button>
                  )}
                </li>
              ))}
              {problems.length > 12 && <li className="text-muted">…e mais {problems.length - 12}.</li>}
            </ul>
          )}
          {invalidDrafts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rose-200 pt-3 text-sm">
              <span className="text-muted">Prefere salvar só as que estão completas?</span>
              <Button size="sm" variant="danger" onClick={removeInvalid}>
                <Trash2 size={13} /> Tirar {invalidDrafts.length} {invalidDrafts.length === 1 ? 'questão' : 'questões'} com problema da importação
              </Button>
            </div>
          )}
        </section>
      )}

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 p-4 shadow-lg backdrop-blur lg:bottom-4">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {hasProblems ? (
            <button
              type="button"
              onClick={() => problemsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="flex items-center gap-1.5 text-left text-sm font-bold text-rose-700 hover:underline"
            >
              <AlertTriangle size={15} className="shrink-0" />
              {problems.length > 0 ? `${problems.length} ${problems.length === 1 ? 'item precisa' : 'itens precisam'} de ajuste — ver` : 'Não foi possível salvar — ver detalhes'}
            </button>
          ) : (
            <span className="hidden text-sm text-muted sm:inline">Tudo certo? As questões serão salvas no seu banco.</span>
          )}
          <Button size="lg" onClick={onConfirm} disabled={total === 0 || saving}>
            <ListChecks size={18} /> {saving ? 'Salvando…' : `Confirmar e salvar ${total}`}
          </Button>
        </div>
      </div>

      {editingCard && <CardEditor card={editingCard} onClose={() => setEditingCard(null)} onSave={saveCard} />}
      {editingQ && (
        <QuestionEditor
          open
          initial={editingQ}
          onClose={() => setEditingQ(null)}
          onSave={(q) => {
            onChange({ ...state, drafts: { ...drafts, [q.id]: { ...q, flags: [] } } })
            setEditingQ(null)
          }}
        />
      )}
    </div>
  )
}

function DropCard({ card, children, onEdit, onRemove }: { card: ImportCard; children: ReactNode; onEdit: () => void; onRemove?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: card.id })
  return (
    <div ref={setNodeRef} className={clsx('card flex min-w-0 flex-col p-4 transition', isOver && 'border-brand-400 ring-4 ring-brand-100')}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">
            {card.area || 'Sem área'} › {card.discipline || 'Sem disciplina'}
          </p>
          <h3 className="truncate text-base font-bold">{card.topic || 'Sem assunto'}</h3>
          {card.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{card.description}</p>}
        </div>
        <Badge tone="brand">{card.questionIds.length}</Badge>
        <button onClick={onEdit} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label="Editar card">
          <Pencil size={15} />
        </button>
        {onRemove && (
          <button onClick={onRemove} className="rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600" aria-label="Remover card" title="Remover card (questões vão para o primeiro card)">
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="scrollbar-thin max-h-96 space-y-2 overflow-y-auto pr-1">{children}</div>
    </div>
  )
}

function DraggableQuestion({
  q,
  cards,
  currentCardId,
  onMove,
  onEdit,
  onRemove,
}: {
  q: DraftQuestion
  cards: ImportCard[]
  currentCardId: string
  onMove: (to: string) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: q.id })
  return (
    <div ref={setNodeRef} className={clsx(isDragging && 'opacity-30')}>
      <QuestionChip q={q} handleProps={{ ...attributes, ...listeners }}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="max-w-[60%] rounded-lg border border-line bg-white px-2 py-1 text-xs"
            value={currentCardId}
            onChange={(e) => onMove(e.target.value)}
            aria-label="Mover para outro card"
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                Mover para: {c.topic || c.discipline || 'card sem nome'}
              </option>
            ))}
          </select>
          <button onClick={onEdit} className="text-xs font-bold text-brand-600 hover:underline">
            Editar
          </button>
          <button onClick={onRemove} className="text-xs font-bold text-rose-600 hover:underline">
            Descartar
          </button>
        </div>
      </QuestionChip>
    </div>
  )
}

/** Guia do documento (instruções e temas por questão usados na classificação) + avisos do processamento. */
function DocumentNotes({ notes }: { notes: ReviewNotes }) {
  const { guide, warnings } = notes
  const quota = warnings.filter((w) => /cota/i.test(w))
  const others = warnings.filter((w) => !/cota/i.test(w))
  const hasGuide = !!guide && (guide.topics.length > 0 || !!guide.instructions)
  if (!hasGuide && !warnings.length) return null
  return (
    <div className="space-y-3">
      {quota.length > 0 && (
        <section role="status" className="rounded-2xl border border-gold-300 bg-gold-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-bold text-gold-600">
            <AlertTriangle size={16} /> A cota diária de IA acabou durante a importação
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
            {quota.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            A cota renova amanhã. Para não esperar, use o método <b>“Usar meu agente de IA”</b> na importação: ele não usa a cota do sistema.
          </p>
        </section>
      )}
      {hasGuide && guide && (
        <details className="card p-4 text-sm">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-bold">
            <BookOpen size={16} className="text-brand-600" /> Guia do documento{guide.page ? ` (pág. ${guide.page})` : ''}
            {guide.topics.length > 0 && <Badge tone="brand">{guide.topics.length} temas por questão</Badge>}
            {guide.instructions && <Badge tone="neutral">instruções</Badge>}
          </summary>
          {guide.instructions && <p className="mt-3 whitespace-pre-line break-words text-slate-700">{guide.instructions}</p>}
          {guide.topics.length > 0 && (
            <ul className="mt-3 space-y-1">
              {guide.topics.map((t) => (
                <li key={t.source} className="flex gap-2 break-words">
                  <span className="shrink-0 font-mono text-xs text-muted">{t.source}</span>
                  <span>{t.assunto}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">As questões listadas foram agrupadas pelos temas que o próprio documento indica. Confira e ajuste os cards se precisar.</p>
        </details>
      )}
      {others.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-bold">Avisos do processamento ({others.length})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-700">
            {others.map((w) => (
              <li key={w} className="break-words">
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function QuestionChip({ q, dragging, handleProps, children }: { q: DraftQuestion; dragging?: boolean; handleProps?: Record<string, unknown>; children?: ReactNode }) {
  return (
    <div className={clsx('rounded-xl border bg-white p-3 text-sm', dragging ? 'rotate-1 border-brand-400 shadow-xl' : 'border-line', q.flags?.length && 'border-l-4 border-l-gold-400')}>
      <div className="flex gap-2">
        <button {...handleProps} className="mt-0.5 cursor-grab touch-none text-slate-300 hover:text-brand-500 active:cursor-grabbing" aria-label="Arrastar questão">
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap gap-1">
            {q.sourceLabel && <Badge tone="neutral">{q.sourceLabel}</Badge>}
            <Badge tone="blue">{q.items.length > 1 ? `${q.items.length} perguntas` : 'pergunta única'}</Badge>
            {q.items.some((i) => i.alternatives?.some((a) => a.source === 'ia')) && <Badge tone="gold">múltipla escolha IA</Badge>}
            {q.flags?.map((f) => (
              <Badge key={f} tone={f.startsWith('Guardrail') ? 'red' : 'gold'}>
                {f}
              </Badge>
            ))}
          </div>
          <p className="line-clamp-3 leading-snug">{q.stem}</p>
          {q.items.length > 1 && (
            <ul className="mt-1.5 space-y-0.5 border-l-2 border-brand-100 pl-2 text-xs text-muted">
              {q.items.map((it, i) => (
                <li key={it.id} className="truncate">
                  <b className="text-ink">{it.label ?? i + 1})</b> {it.prompt || '—'} {!it.expectedAnswer && !it.alternatives?.length && <span className="font-bold text-gold-600">· sem resposta</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function CardEditor({ card, onClose, onSave }: { card: ImportCard; onClose: () => void; onSave: (c: ImportCard) => void }) {
  const [c, setC] = useState(card)
  return (
    <Modal
      open
      onClose={onClose}
      title={card.questionIds.length || card.area ? 'Editar card' : 'Novo card'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!c.area.trim() || !c.discipline.trim()} onClick={() => onSave(c)}>
            Salvar card
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Área" hint="Ex.: Medicina, Matemática, Direito">
          <input className={inputClass} value={c.area} onChange={(e) => setC({ ...c, area: e.target.value })} />
        </Field>
        <Field label="Disciplina" hint="Ex.: Cardiologia, Cálculo">
          <input className={inputClass} value={c.discipline} onChange={(e) => setC({ ...c, discipline: e.target.value })} />
        </Field>
        <Field label="Assunto (opcional)" hint="Ex.: Hipertensão arterial — permite simulados bem específicos">
          <input className={inputClass} value={c.topic} onChange={(e) => setC({ ...c, topic: e.target.value })} />
        </Field>
        <Field label="Descrição">
          <textarea className={clsx(inputClass, 'min-h-20')} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
