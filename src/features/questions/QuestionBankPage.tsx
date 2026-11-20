import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { FileUp, Globe2, Library, Lock, Plus, Search, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Question } from '@shared/domain'
import type { QuestionInput } from '@shared/schemas/question'
import { hasValidAlternatives } from '@shared/simulado'
import { useAuth } from '@/app/auth-context'
import { Badge, Button, Card, EmptyState, Field, inputClass, Modal, PageHeader, Segmented } from '@/components/ui'
import { api, unwrap } from '@/lib/api'
import { difficultyLabel, LETTERS } from '@/lib/format'
import { QuestionEditor } from './QuestionEditor'

type Scope = 'todas' | 'minhas' | 'comunidade'
type Draft = Parameters<typeof QuestionEditor>[0]['initial']

interface Classification {
  areaId: string
  discipline: string
  topic: string
}

/** Banco de questões lido da API (`/api/questions`, spec 002 › US5). */
export function QuestionBankPage() {
  const { user, mode } = useAuth()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>('todas')
  const [areaId, setAreaId] = useState<string>('')
  const [groupId, setGroupId] = useState<string>('')
  const [term, setTerm] = useState('')
  const [preview, setPreview] = useState<Question | null>(null)
  const [editing, setEditing] = useState<{ question: Question | null; draft: Draft; cls: Classification } | null>(null)
  const [removing, setRemoving] = useState<Question | null>(null)

  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: () => unwrap(api.taxonomy.index.$get()), staleTime: 5 * 60_000, enabled: mode === 'real' })
  const list = useQuery({
    queryKey: ['questions', { scope, areaId }],
    queryFn: () => unwrap(api.questions.index.$get({ query: { scope, ...(areaId ? { areaId } : {}), limit: '500' } })),
    enabled: mode === 'real',
  })

  const areaName = (id: string) => taxonomy.data?.areas.find((a) => a.id === id)?.name ?? '—'
  const disciplineName = (id: string) => taxonomy.data?.disciplines.find((d) => d.id === id)?.name ?? '—'

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: QuestionInput }) =>
      id ? unwrap(api.questions[':id'].$put({ param: { id }, json: input })) : unwrap(api.questions.index.$post({ json: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
      setEditing(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.questions[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      setRemoving(null)
    },
  })

  const questions = useMemo(() => list.data?.questions ?? [], [list.data])
  const groups = (list.data?.groups ?? [])
    .map((g) => ({ g, count: questions.filter((q) => q.groupId === g.id).length }))
    .filter((x) => x.count > 0)

  const visible = questions.filter((q) => {
    if (groupId && q.groupId !== groupId) return false
    if (term && !`${q.stem} ${q.items.map((i) => i.prompt).join(' ')} ${q.topic ?? ''}`.toLowerCase().includes(term.toLowerCase())) return false
    return true
  })

  function openNew() {
    save.reset()
    const g = list.data?.groups.find((x) => x.id === groupId)
    setEditing({
      question: null,
      draft: {
        id: 'nova',
        stem: '',
        items: [{ id: crypto.randomUUID(), prompt: '', type: 'discursiva', expectedAnswer: '', keyPoints: [] }],
        difficulty: 'media',
        visibility: 'privada',
        origin: 'manual',
      },
      cls: { areaId: g?.areaId ?? areaId, discipline: g ? disciplineName(g.disciplineId) : '', topic: g?.topic ?? '' },
    })
  }

  function openEdit(q: Question) {
    save.reset()
    setEditing({ question: q, draft: q, cls: { areaId: q.areaId, discipline: disciplineName(q.disciplineId), topic: q.topic ?? '' } })
  }

  if (mode === 'prototipo')
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader eyebrow="Banco de questões" title="Suas questões e as da comunidade" />
        <EmptyState icon={<Library />} title="O banco de questões usa a API real">
          Rode <code>npm run dev:api</code> (com o <code>.env</code> configurado) e entre com o Google.
        </EmptyState>
      </div>
    )

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Banco de questões"
        title="Suas questões e as da comunidade"
        description="Organizadas por Área › Disciplina › Assunto. Questões públicas de outros estudantes podem entrar nos seus simulados."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={openNew} disabled={!taxonomy.data}>
              <Plus size={16} /> Nova questão
            </Button>
            <Link to="/importar">
              <Button>
                <FileUp size={16} /> Importar questões
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v)
            setGroupId('')
          }}
          options={[
            { value: 'todas', label: 'Todas' },
            { value: 'minhas', label: 'Minhas' },
            { value: 'comunidade', label: 'Comunidade' },
          ]}
        />
        <select
          className={clsx(inputClass, 'w-auto')}
          value={areaId}
          onChange={(e) => {
            setAreaId(e.target.value)
            setGroupId('')
          }}
          aria-label="Filtrar por área"
        >
          <option value="">Todas as áreas</option>
          {taxonomy.data?.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="relative min-w-56 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={clsx(inputClass, 'pl-9')} placeholder="Buscar no enunciado…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar no enunciado" />
        </div>
      </div>

      {/* Cards por assunto */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ g, count }) => {
          const mine = g.ownerId === user?.id
          return (
            <button
              key={g.id}
              onClick={() => setGroupId(groupId === g.id ? '' : g.id)}
              className={clsx('card p-4 text-left transition', groupId === g.id ? 'border-brand-500 ring-4 ring-brand-100' : 'hover:border-brand-200')}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">
                  {areaName(g.areaId)} › {disciplineName(g.disciplineId)}
                </p>
                <Badge tone={mine ? 'brand' : 'blue'}>{mine ? 'minha' : <><Users size={11} /> comunidade</>}</Badge>
              </div>
              <p className="mt-1 font-display font-bold">{g.topic ?? 'Sem assunto'}</p>
              {g.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{g.description}</p>}
              <p className="mt-3 text-xs font-bold text-muted">{count} questões</p>
            </button>
          )
        })}
      </div>

      {list.isPending ? (
        <Card className="p-6 text-center text-sm text-muted" aria-live="polite">
          Carregando questões…
        </Card>
      ) : list.isError ? (
        <Card className="p-6 text-center text-sm">
          <p role="alert" className="font-bold text-rose-600">
            {list.error.message}
          </p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => void list.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyState icon={<Library />} title="Nenhuma questão com esses filtros">
          Importe um PDF ou cadastre manualmente em “Nova questão”.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {visible.map((q) => {
            const mine = q.ownerId === user?.id
            return (
              <div key={q.id} className="flex flex-wrap items-center gap-3 p-4">
                <button className="min-w-0 flex-1 text-left" onClick={() => setPreview(q)}>
                  <div className="mb-1 flex flex-wrap gap-1.5">
                    {q.sourceLabel && <Badge tone="neutral">{q.sourceLabel}</Badge>}
                    <Badge tone="blue">{q.items.length > 1 ? `${q.items.length} perguntas` : 'pergunta única'}</Badge>
                    {q.items.every((i) => hasValidAlternatives(i)) && <Badge tone="blue">múltipla escolha</Badge>}
                    {q.items.some((i) => i.type === 'discursiva') && <Badge tone="neutral">discursiva</Badge>}
                    <Badge tone="neutral">{difficultyLabel[q.difficulty]}</Badge>
                    {q.topic && <Badge tone="brand">{q.topic}</Badge>}
                    {mine && (q.visibility === 'publica' ? <Badge tone="green"><Globe2 size={11} /> pública</Badge> : <Badge tone="neutral"><Lock size={11} /> privada</Badge>)}
                    {q.origin === 'pdf_ia' && <Badge tone="gold">via PDF</Badge>}
                  </div>
                  <p className="line-clamp-2 text-sm">{q.stem}</p>
                </button>
                {mine && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(q)}>
                      Editar
                    </Button>
                    <button
                      className="rounded-lg p-2 text-muted hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => {
                        remove.reset()
                        setRemoving(q)
                      }}
                      aria-label="Excluir questão"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}
      {list.data && list.data.total > questions.length && (
        <p className="mt-3 text-center text-xs text-muted">
          Mostrando {questions.length} de {list.data.total} questões. Use os filtros para refinar.
        </p>
      )}

      {preview && (
        <Modal open onClose={() => setPreview(null)} title="Questão" wide>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {areaName(preview.areaId)} › {disciplineName(preview.disciplineId)}
            {preview.topic && ` · ${preview.topic}`}
          </p>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">Enunciado</p>
          <p className="mt-1 whitespace-pre-line rounded-xl bg-brand-50/60 p-3 text-sm">{preview.stem}</p>
          {preview.items.map((it, j) => (
            <div key={it.id} className="mt-4">
              {preview.items.length > 1 && (
                <p className="font-display font-semibold">
                  {it.label ?? j + 1}) {it.prompt}
                </p>
              )}
              {!!it.alternatives?.length && (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {it.alternatives.map((a, i) => (
                    <li key={a.id} className={clsx('rounded-xl border p-2.5', a.correct ? 'border-emerald-300 bg-emerald-50' : 'border-line')}>
                      <b>{LETTERS[i]})</b> {a.text} {a.source === 'ia' && <Badge tone="gold">IA</Badge>}
                      {a.explanation && <span className="mt-0.5 block text-xs text-muted">{a.explanation}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {it.expectedAnswer && (
                <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm">
                  <p className="text-xs font-bold uppercase text-emerald-700">Resposta esperada</p>
                  <p className="mt-1 whitespace-pre-line">{it.expectedAnswer}</p>
                  {!!it.keyPoints?.length && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-emerald-800">
                      {it.keyPoints.map((k) => (
                        <li key={k}>{k}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </Modal>
      )}

      {editing && taxonomy.data && (
        <QuestionEditor
          open
          title={editing.question ? 'Editar questão' : 'Nova questão'}
          initial={editing.draft}
          onClose={() => setEditing(null)}
          saving={save.isPending}
          serverError={save.error?.message}
          extraErrors={classificationErrors(editing.cls)}
          header={
            <ClassificationFields
              value={editing.cls}
              onChange={(cls) => setEditing((e) => (e ? { ...e, cls } : e))}
              areas={taxonomy.data.areas}
              disciplines={taxonomy.data.disciplines}
            />
          }
          onSave={(d) => save.mutate({ id: editing.question?.id ?? null, input: toInput(d, editing.cls) })}
        />
      )}

      {removing && (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title="Excluir questão?"
          footer={
            <>
              {remove.error && (
                <span role="alert" className="mr-auto self-center text-xs font-bold text-rose-600">
                  {remove.error.message}
                </span>
              )}
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(removing.id)}>
                {remove.isPending ? 'Excluindo…' : 'Excluir'}
              </Button>
            </>
          }
        >
          <p className="line-clamp-3 text-sm">{removing.stem}</p>
          <p className="mt-3 text-xs text-muted">A questão sai do seu banco e dos próximos simulados. Simulados já feitos mantêm o histórico.</p>
        </Modal>
      )}
    </div>
  )
}

function classificationErrors(c: Classification): string[] {
  const errors: string[] = []
  if (!c.areaId) errors.push('Escolha a área.')
  if (c.discipline.trim().length < 2) errors.push('Informe a disciplina.')
  return errors
}

/** Área (lista fixa) › Disciplina (escolha ou digite uma nova) › Assunto (livre, amplo). */
function ClassificationFields({
  value,
  onChange,
  areas,
  disciplines,
}: {
  value: Classification
  onChange: (c: Classification) => void
  areas: { id: string; name: string }[]
  disciplines: { id: string; areaId: string; name: string }[]
}) {
  const options = disciplines.filter((d) => d.areaId === value.areaId)
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-brand-50/40 p-4 sm:grid-cols-3">
      <Field label="Área">
        <select className={inputClass} value={value.areaId} onChange={(e) => onChange({ ...value, areaId: e.target.value })}>
          <option value="">Escolha…</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Disciplina">
        <input
          className={inputClass}
          list="disciplinas-da-area"
          value={value.discipline}
          maxLength={80}
          placeholder="Ex.: Cardiologia"
          onChange={(e) => onChange({ ...value, discipline: e.target.value })}
        />
        <datalist id="disciplinas-da-area">
          {options.map((d) => (
            <option key={d.id} value={d.name} />
          ))}
        </datalist>
      </Field>
      <Field label="Assunto (opcional)">
        <input className={inputClass} value={value.topic} maxLength={120} placeholder="Tema da aula" onChange={(e) => onChange({ ...value, topic: e.target.value })} />
      </Field>
    </div>
  )
}

function toInput(d: Draft, c: Classification): QuestionInput {
  return {
    areaId: c.areaId,
    discipline: c.discipline,
    topic: c.topic || undefined,
    sourceLabel: d.sourceLabel,
    stem: d.stem,
    difficulty: d.difficulty,
    visibility: d.visibility,
    hasImage: d.hasImage ?? false,
    imageDescription: d.imageDescription,
    items: d.items.map((it) => ({
      id: it.id,
      label: it.label,
      prompt: it.prompt,
      type: it.type,
      expectedAnswer: it.expectedAnswer,
      keyPoints: it.keyPoints ?? [],
      alternatives: (it.alternatives ?? []).map((a) => ({ id: a.id, text: a.text, correct: a.correct, explanation: a.explanation, source: a.source })),
    })),
  }
}
