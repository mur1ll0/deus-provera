import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, Eye, FileUp, Globe2, Library, ListChecks, Lock, Pencil, PenLine, Plus, Search, Sparkles, Trash2, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Question } from '@shared/domain'
import { missingFormats, needsDiscursive, needsMultipleChoice } from '@shared/completeness'
import type { QuestionInput } from '@shared/schemas/question'
import { hasValidAlternatives } from '@shared/simulado'
import { useAuth } from '@/app/auth-context'
import { ChipPicker, ClearButton, type Option } from '@/components/ChipPicker'
import { foldText, sortByName } from '@/lib/text'
import { Badge, Button, Card, EmptyState, Field, inputClass, Modal, PageHeader, Segmented } from '@/components/ui'
import { RichText } from '@/components/RichText'
import { api, unwrap } from '@/lib/api'
import { difficultyLabel, LETTERS } from '@/lib/format'
import { CompleteFormatsDialog, type MissingKind } from './CompleteFormats'
import { QuestionEditor } from './QuestionEditor'
import { classificationErrors, toInput, type Classification } from './questionInput'

type Scope = 'todas' | 'minhas' | 'comunidade'
type Draft = Parameters<typeof QuestionEditor>[0]['initial']

/** Banco de questões lido da API (`/api/questions`, spec 002 › US5). */
export function QuestionBankPage() {
  const { user, mode } = useAuth()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>('todas')
  const [areaId, setAreaId] = useState<string>('')
  // Disciplinas pelo nome normalizado (a mesma disciplina pode existir em várias áreas).
  const [disciplines, setDisciplines] = useState<string[]>([])
  const [topics, setTopics] = useState<string[]>([])
  const [term, setTerm] = useState('')
  const [preview, setPreview] = useState<Question | null>(null)
  const [editing, setEditing] = useState<{ question: Question | null; draft: Draft; cls: Classification } | null>(null)
  const [removing, setRemoving] = useState<Question | null>(null)
  const [completing, setCompleting] = useState<MissingKind | null>(null)
  // No celular, disciplinas e assuntos ficam recolhidos (a lista de questões aparece sem rolar a tela toda).
  const [showFilters, setShowFilters] = useState(false)

  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: () => unwrap(api.taxonomy.index.$get()), staleTime: 5 * 60_000, enabled: mode === 'real' })
  const list = useQuery({
    queryKey: ['questions', { scope, areaId }],
    queryFn: () => unwrap(api.questions.index.$get({ query: { scope, ...(areaId ? { areaId } : {}), limit: '500' } })),
    enabled: mode === 'real',
  })

  const areaName = (id: string) => taxonomy.data?.areas.find((a) => a.id === id)?.name ?? '—'
  const disciplineName = (id: string) => taxonomy.data?.disciplines.find((d) => d.id === id)?.name ?? '—'
  const classificationOf = (q: Question): Classification => ({ areaId: q.areaId, discipline: disciplineName(q.disciplineId), topic: q.topic ?? '' })

  const putQuestion = (id: string | null, input: QuestionInput) =>
    id ? unwrap(api.questions[':id'].$put({ param: { id }, json: input })) : unwrap(api.questions.index.$post({ json: input }))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['questions'] })
    void queryClient.invalidateQueries({ queryKey: ['taxonomy'] })
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: QuestionInput }) => putQuestion(id, input),
    onSuccess: () => {
      refresh()
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
  const discKey = (q: Question) => foldText(disciplineName(q.disciplineId))

  // Opções com contagem, como na montagem do simulado: disciplinas das questões carregadas; assuntos das disciplinas escolhidas.
  const disciplineOptions = countOptions(questions, discKey, (q) => disciplineName(q.disciplineId))
  const inDisciplines = (q: Question) => !disciplines.length || disciplines.includes(discKey(q))
  const topicOptions = countOptions(questions.filter((q) => q.topic && inDisciplines(q)), (q) => q.topic!, (q) => q.topic!)

  const t = foldText(term)
  const visible = questions.filter((q) => {
    if (!inDisciplines(q)) return false
    if (topics.length && !topics.includes(q.topic ?? '')) return false
    if (t && !foldText(`${q.stem} ${q.items.map((i) => i.prompt).join(' ')} ${q.topic ?? ''} ${q.sourceLabel ?? ''}`).includes(t)) return false
    return true
  })
  const mineVisible = visible.filter((q) => q.ownerId === user?.id)
  const missing = missingFormats(mineVisible)
  const filtered = disciplines.length > 0 || topics.length > 0 || !!term || !!areaId

  function clearFilters() {
    setDisciplines([])
    setTopics([])
    setTerm('')
  }

  function openNew() {
    save.reset()
    const one = visible[0]
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
      // Já vem com a área/disciplina/assunto filtrados (cadastro em sequência do mesmo tema).
      cls: {
        areaId: areaId || (disciplines.length === 1 && one ? one.areaId : ''),
        discipline: disciplines.length === 1 && one ? disciplineName(one.disciplineId) : '',
        topic: topics.length === 1 ? topics[0] : '',
      },
    })
  }

  function openEdit(q: Question) {
    save.reset()
    setPreview(null)
    setEditing({ question: q, draft: q, cls: classificationOf(q) })
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
        description="Organizadas por Área › Disciplina › Assunto. Clique numa questão sua para editar. Questões públicas de outros estudantes podem entrar nos seus simulados."
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

      {/* Filtros */}
      <Card className="mb-5 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={scope}
            onChange={(v) => {
              setScope(v)
              clearFilters()
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
              setDisciplines([])
              setTopics([])
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
            <input className={clsx(inputClass, 'pl-9')} placeholder="Buscar no enunciado, perguntas ou rótulo…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar questões" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-sm font-bold sm:hidden"
        >
          <span>
            Disciplinas e assuntos
            {disciplines.length + topics.length > 0 && <span className="ml-1.5 text-brand-600">({disciplines.length + topics.length} ativos)</span>}
          </span>
          <ChevronDown size={16} className={clsx('transition', showFilters && 'rotate-180')} />
        </button>

        <div className={clsx('space-y-4', !showFilters && 'hidden sm:block')}>
          <FilterRow
            title="Disciplinas"
            hint={disciplines.length ? `${disciplines.length} selecionada${disciplines.length > 1 ? 's' : ''}` : 'Nenhuma selecionada = todas'}
            onClear={
              disciplines.length > 0
                ? () => {
                    setDisciplines([])
                    setTopics([])
                  }
                : undefined
            }
          >
            <ChipPicker
              label="disciplina"
              options={disciplineOptions}
              isActive={(o) => disciplines.includes(o.key)}
              onToggle={(o) => {
                setTopics([])
                setDisciplines((d) => (d.includes(o.key) ? d.filter((x) => x !== o.key) : [...d, o.key]))
              }}
              empty={list.isPending ? 'Carregando…' : 'Nenhuma questão com esses filtros.'}
            />
          </FilterRow>

          {topicOptions.length > 0 && (
            <FilterRow
              title="Assuntos"
              hint={topics.length ? `${topics.length} selecionado${topics.length > 1 ? 's' : ''}` : 'Opcional'}
              onClear={topics.length > 0 ? () => setTopics([]) : undefined}
            >
              <ChipPicker
                label="assunto"
                options={topicOptions}
                isActive={(o) => topics.includes(o.key)}
                onToggle={(o) => setTopics((ts) => (ts.includes(o.key) ? ts.filter((x) => x !== o.key) : [...ts, o.key]))}
              />
            </FilterRow>
          )}
        </div>
      </Card>

      {/* Complete as suas questões: falta múltipla escolha ou resposta discursiva (FR-R8) */}
      {(missing.multipla.length > 0 || missing.discursiva.length > 0) && (
        <Card className="mb-5 border-gold-300 bg-gold-50/70 p-4">
          <div className="flex items-start gap-3">
            <Sparkles size={20} className="mt-0.5 shrink-0 text-gold-600" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-bold">Complete as suas questões</p>
              <p className="text-muted">
                Com os dois formatos, a questão entra em simulados de múltipla escolha e discursivos. A IA gera e você revisa antes de salvar
                {filtered ? ' (vale para as questões filtradas).' : '.'}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 sm:pl-8">
            {missing.multipla.length > 0 && (
              <Button size="sm" variant="gold" onClick={() => setCompleting('multipla')}>
                <ListChecks size={14} /> Gerar múltipla escolha em {missing.multipla.length} {missing.multipla.length === 1 ? 'questão' : 'questões'}
              </Button>
            )}
            {missing.discursiva.length > 0 && (
              <Button size="sm" variant="gold" onClick={() => setCompleting('discursiva')}>
                <PenLine size={14} /> Gerar discursiva em {missing.discursiva.length} {missing.discursiva.length === 1 ? 'questão' : 'questões'}
              </Button>
            )}
          </div>
        </Card>
      )}

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
          {filtered ? (
            <button className="font-bold text-brand-600 hover:underline" onClick={clearFilters}>
              Limpar filtros
            </button>
          ) : (
            'Importe um PDF ou cadastre manualmente em “Nova questão”.'
          )}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-xs font-bold text-muted">
            {visible.length} {visible.length === 1 ? 'questão' : 'questões'}
            {filtered && (
              <button className="ml-2 inline-flex items-center gap-0.5 text-brand-600 hover:underline" onClick={clearFilters}>
                <X size={12} /> limpar filtros
              </button>
            )}
          </p>
          <Card className="divide-y divide-line">
            {visible.map((q) => {
              const mine = q.ownerId === user?.id
              return (
                <div key={q.id} className="group flex flex-wrap items-center gap-3 p-4 transition hover:bg-brand-50/40">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => (mine ? openEdit(q) : setPreview(q))}
                    title={mine ? 'Editar questão' : 'Ver questão'}
                  >
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand-600">
                      {areaName(q.areaId)} › {disciplineName(q.disciplineId)}
                    </p>
                    <div className="mb-1 flex flex-wrap gap-1.5">
                      {q.sourceLabel && <Badge tone="neutral">{q.sourceLabel}</Badge>}
                      <Badge tone="blue">{q.items.length > 1 ? `${q.items.length} perguntas` : 'pergunta única'}</Badge>
                      {q.items.every((i) => hasValidAlternatives(i)) && <Badge tone="blue">múltipla escolha</Badge>}
                      {q.items.every((i) => !!i.expectedAnswer?.trim()) && <Badge tone="neutral">discursiva</Badge>}
                      {mine && q.items.some(needsMultipleChoice) && <Badge tone="gold">sem alternativas</Badge>}
                      {mine && q.items.some(needsDiscursive) && <Badge tone="gold">sem resposta escrita</Badge>}
                      <Badge tone="neutral">{difficultyLabel[q.difficulty]}</Badge>
                      {q.topic && <Badge tone="brand">{q.topic}</Badge>}
                      {mine ? (
                        q.visibility === 'publica' ? (
                          <Badge tone="green">
                            <Globe2 size={11} /> pública
                          </Badge>
                        ) : (
                          <Badge tone="neutral">
                            <Lock size={11} /> privada
                          </Badge>
                        )
                      ) : (
                        <Badge tone="blue">
                          <Users size={11} /> comunidade
                        </Badge>
                      )}
                      {q.origin === 'pdf_ia' && <Badge tone="gold">via PDF</Badge>}
                    </div>
                    <p className="line-clamp-2 text-sm">{q.stem}</p>
                  </button>
                  <div className="flex gap-1">
                    <button className="rounded-lg p-2 text-muted hover:bg-brand-50 hover:text-brand-700" onClick={() => setPreview(q)} aria-label="Ver questão" title="Ver">
                      <Eye size={15} />
                    </button>
                    {mine && (
                      <>
                        <button className="rounded-lg p-2 text-muted hover:bg-brand-50 hover:text-brand-700" onClick={() => openEdit(q)} aria-label="Editar questão" title="Editar">
                          <Pencil size={15} />
                        </button>
                        <button
                          className="rounded-lg p-2 text-muted hover:bg-rose-50 hover:text-rose-600"
                          onClick={() => {
                            remove.reset()
                            setRemoving(q)
                          }}
                          aria-label="Excluir questão"
                          title="Excluir"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>
        </>
      )}
      {list.data && list.data.total > questions.length && (
        <p className="mt-3 text-center text-xs text-muted">
          Mostrando {questions.length} de {list.data.total} questões. Use os filtros para refinar.
        </p>
      )}

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title="Questão"
          wide
          footer={
            preview.ownerId === user?.id && (
              <Button onClick={() => openEdit(preview)}>
                <Pencil size={15} /> Editar
              </Button>
            )
          }
        >
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {areaName(preview.areaId)} › {disciplineName(preview.disciplineId)}
            {preview.topic && ` · ${preview.topic}`}
          </p>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">Enunciado</p>
          <RichText text={preview.stem} className="mt-1 rounded-xl bg-brand-50/60 p-3 text-sm" />
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted">{preview.items.length > 1 ? `Perguntas (${preview.items.length})` : 'Resposta'}</p>
          <ol className="mt-1 space-y-3">
            {preview.items.map((it, j) => (
              <li key={it.id} className="rounded-2xl border border-line p-3">
                {preview.items.length > 1 && (
                  <div className="flex gap-2 font-display font-semibold">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs text-white">{it.label ?? j + 1}</span>
                    <RichText text={it.prompt} className="min-w-0 flex-1" />
                  </div>
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
                    <RichText text={it.expectedAnswer} className="mt-1" />
                    {!!it.keyPoints?.length && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-emerald-800">
                        {it.keyPoints.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
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

      {completing && (
        <CompleteFormatsDialog
          kind={completing}
          questions={completing === 'multipla' ? missing.multipla : missing.discursiva}
          onClose={() => setCompleting(null)}
          save={(q, d) => putQuestion(q.id, toInput(d, classificationOf(q)))}
          onSaved={refresh}
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

/** Opções de chip com a contagem de questões ("Cardiologia (12)"), agrupadas pela chave. */
function countOptions(questions: Question[], key: (q: Question) => string, name: (q: Question) => string): Option[] {
  const m = new Map<string, { name: string; n: number }>()
  for (const q of questions) {
    const k = key(q)
    const cur = m.get(k)
    if (cur) cur.n++
    else m.set(k, { name: name(q), n: 1 })
  }
  return sortByName([...m.entries()].map(([k, v]) => ({ key: k, name: `${v.name} (${v.n})`, ids: [k] })))
}

function FilterRow({ title, hint, onClear, children }: { title: string; hint?: string; onClear?: () => void; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="flex items-baseline gap-3">
          {hint && <span className="text-xs text-muted">{hint}</span>}
          {onClear && <ClearButton onClick={onClear} />}
        </span>
      </div>
      {children}
    </div>
  )
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
    <div className="grid gap-3 rounded-2xl border border-line bg-brand-50/40 p-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
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
