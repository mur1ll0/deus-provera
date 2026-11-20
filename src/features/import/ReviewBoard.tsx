import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import clsx from 'clsx'
import { AlertTriangle, FolderPlus, GripVertical, Layers, ListChecks, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Card, DemoTag, Field, inputClass, Modal } from '@/components/ui'
import { aiGenerateDistractors } from '@/mocks/ai'
import { uid, type DraftQuestion, type ImportCard } from '@/mocks/model'
import { QuestionEditor } from '@/features/questions/QuestionEditor'
import type { ReviewState } from './drafts'

/**
 * Tela de revisão pós-processamento: cards por Área › Disciplina · Assunto.
 * O usuário arrasta questões entre cards, edita/cria cards e questões e confirma para salvar.
 */
export function ReviewBoard({ state, onChange, onConfirm, onBack }: { state: ReviewState; onChange: (s: ReviewState) => void; onConfirm: () => void; onBack: () => void }) {
  const [editingCard, setEditingCard] = useState<ImportCard | null>(null)
  const [editingQ, setEditingQ] = useState<DraftQuestion | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [bulk, setBulk] = useState<'idle' | 'running' | 'done'>('idle')
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

  async function generateAllDistractors() {
    setBulk('running')
    const next = { ...drafts }
    for (const d of Object.values(drafts)) {
      if (!d.items.some((i) => !i.alternatives?.length && i.expectedAnswer)) continue
      const items = []
      for (const it of d.items) {
        items.push(!it.alternatives?.length && it.expectedAnswer ? { ...it, alternatives: await aiGenerateDistractors(it) } : it)
      }
      next[d.id] = { ...d, items }
    }
    onChange({ ...state, drafts: next })
    setBulk('done')
  }

  const activeDraft = activeId ? drafts[activeId] : null

  return (
    <div className="space-y-5">
      {/* Barra de resumo */}
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="brand">{total} questões</Badge>
          <Badge tone="neutral">{cards.length} cards</Badge>
          {flagged > 0 && (
            <Badge tone="gold">
              <AlertTriangle size={12} /> {flagged} para revisar
            </Badge>
          )}
          {state.fileName && <Badge tone="blue">{state.fileName}</Badge>}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {perguntasSemAlt > 0 && (
            <Button size="sm" variant="gold" disabled={bulk === 'running'} onClick={generateAllDistractors}>
              <Sparkles size={14} /> {bulk === 'running' ? 'Gerando…' : `Gerar múltipla escolha p/ ${perguntasSemAlt} perguntas`} <DemoTag />
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

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 p-4 shadow-lg backdrop-blur lg:bottom-4">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">Tudo certo? As questões serão salvas no seu banco.</span>
          <Button size="lg" onClick={onConfirm} disabled={total === 0}>
            <ListChecks size={18} /> Confirmar e salvar {total}
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
    <div ref={setNodeRef} className={clsx('card flex flex-col p-4 transition', isOver && 'border-brand-400 ring-4 ring-brand-100')}>
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
        <Field label="Disciplina" hint="Ex.: Ginecologia, Cálculo">
          <input className={inputClass} value={c.discipline} onChange={(e) => setC({ ...c, discipline: e.target.value })} />
        </Field>
        <Field label="Assunto (opcional)" hint="Ex.: Prolapso genital — permite simulados bem específicos">
          <input className={inputClass} value={c.topic} onChange={(e) => setC({ ...c, topic: e.target.value })} />
        </Field>
        <Field label="Descrição">
          <textarea className={clsx(inputClass, 'min-h-20')} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
