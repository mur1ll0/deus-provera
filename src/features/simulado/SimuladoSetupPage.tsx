import clsx from 'clsx'
import { BrainCircuit, Eye, EyeOff, GraduationCap, History, Lock, Play, Repeat, Shuffle, Users, User } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { SimuladoConfig } from '@shared/domain'
import { BASE_POINTS, MODE_MULTIPLIER, PROVA_RULES } from '@shared/scoring'
import { autoTimeLimitMin } from '@shared/simulado'
import { useAuth } from '@/app/auth-context'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { useSetupSource } from './setupSource'


export function SimuladoSetupPage() {
  const real = useAuth().mode === 'real'
  // "Treinar pontos fracos" (painel) chega com ?assunto=… pré-selecionado (spec 004 › T016).
  const [params] = useSearchParams()
  const focus = params.get('assunto')
  const [cfg, setCfg] = useState<SimuladoConfig>({
    mode: 'treino',
    scope: 'minhas_e_comunidade',
    // Protótipo: área "Medicina" dos dados simulados; API real: todas as áreas.
    areaId: real || focus ? null : 'a-med',
    disciplineIds: [],
    topics: focus ? [focus] : [],
    answerFormat: 'original',
    count: 10,
    timeLimitMin: null,
    reveal: 'imediato',
    aiHints: true,
    prioritizeMistakes: false,
  })
  const [autoTime, setAutoTime] = useState(true)
  const set = <K extends keyof SimuladoConfig>(k: K, v: SimuladoConfig[K]) => setCfg((c) => ({ ...c, [k]: v }))

  const isProva = cfg.mode === 'prova'
  const src = useSetupSource(cfg, real)
  const disciplines = src.disciplines.filter((d) => !cfg.areaId || d.areaId === cfg.areaId)
  const topics = src.topics
  const available = src.available
  const count = Math.min(cfg.count, available)
  const estMin = autoTimeLimitMin(src.kinds(count))
  const timeLimit = isProva ? (autoTime ? estMin : cfg.timeLimitMin ?? estMin) : cfg.timeLimitMin
  const maxPoints = Math.round(count * BASE_POINTS.media * MODE_MULTIPLIER[cfg.mode])
  const provaTooShort = isProva && count < PROVA_RULES.minQuestions

  function start() {
    src.start({
      ...cfg,
      count,
      // Prova com tempo automático: o servidor calcula pelo sorteio real (null = automático).
      timeLimitMin: isProva && autoTime && real ? null : (timeLimit ?? null),
      reveal: isProva ? 'final' : cfg.reveal,
      aiHints: isProva ? false : cfg.aiHints,
      topics: isProva ? [] : cfg.topics,
    })
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Simulados"
        title="Monte seu simulado"
        description="Prova: questões sorteadas, tempo limite e gabarito só no final — vale 3× mais pontos. Treino: você escolhe tudo, confere respostas e pede dicas à IA."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          {/* Modo */}
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              active={isProva}
              onClick={() => setCfg((c) => ({ ...c, mode: 'prova', reveal: 'final', aiHints: false, timeLimitMin: c.timeLimitMin ?? 30 }))}
              icon={GraduationCap}
              title="Modo prova"
              mult="×3 pontos"
              items={['Questões aleatórias', 'Tempo limite obrigatório', 'Gabarito só ao final', `Mín. ${PROVA_RULES.minQuestions} questões p/ ranking`]}
            />
            <ModeCard
              active={!isProva}
              onClick={() => setCfg((c) => ({ ...c, mode: 'treino' }))}
              icon={Repeat}
              title="Modo treino"
              mult="×1 ponto"
              items={['Filtre por assunto', 'Confira a cada questão', 'Dicas e explicações com IA', 'Tempo opcional']}
            />
          </div>

          <Section title="Fonte das questões">
            <div className="flex flex-wrap gap-2">
              <Chip active={cfg.scope === 'minhas'} onClick={() => set('scope', 'minhas')}>
                <User size={14} /> Só as minhas
              </Chip>
              <Chip active={cfg.scope === 'minhas_e_comunidade'} onClick={() => set('scope', 'minhas_e_comunidade')}>
                <Users size={14} /> Minhas + comunidade
              </Chip>
            </div>
          </Section>

          <Section title="Área">
            <div className="flex flex-wrap gap-2">
              {src.areas.map((a) => (
                <Chip key={a.id} active={cfg.areaId === a.id} onClick={() => setCfg((c) => ({ ...c, areaId: a.id, disciplineIds: [], topics: [] }))}>
                  {a.name}
                </Chip>
              ))}
              <Chip active={cfg.areaId === null} onClick={() => setCfg((c) => ({ ...c, areaId: null, disciplineIds: [], topics: [] }))}>
                <Shuffle size={14} /> Todas
              </Chip>
            </div>
          </Section>

          <Section title="Disciplinas" hint="Nenhuma selecionada = todas">
            <div className="flex flex-wrap gap-2">
              {disciplines.map((d) => (
                <Chip
                  key={d.id}
                  active={cfg.disciplineIds.includes(d.id)}
                  onClick={() => setCfg((c) => ({ ...c, topics: [], disciplineIds: c.disciplineIds.includes(d.id) ? c.disciplineIds.filter((x) => x !== d.id) : [...c.disciplineIds, d.id] }))}
                >
                  {d.name}
                </Chip>
              ))}
            </div>
          </Section>

          {!isProva && topics.length > 0 && (
            <Section title="Assuntos específicos" hint="Opcional — treino focado">
              <div className="flex flex-wrap gap-2">
                {topics.map((t) => (
                  <Chip key={t} active={cfg.topics.includes(t)} onClick={() => set('topics', cfg.topics.includes(t) ? cfg.topics.filter((x) => x !== t) : [...cfg.topics, t])}>
                    {t}
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          <Section title="Formato de resposta" hint="Cada questão traz todas as suas perguntas">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['original', 'Como cadastrado'],
                  ['multipla', 'Múltipla escolha'],
                  ['discursiva', 'Discursiva (escrever)'],
                ] as const
              ).map(([v, label]) => (
                <Chip key={v} active={cfg.answerFormat === v} onClick={() => set('answerFormat', v)}>
                  {label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {cfg.answerFormat === 'multipla' && 'Só entram questões em que todas as perguntas têm alternativas (originais ou geradas por IA). Correção automática.'}
              {cfg.answerFormat === 'discursiva' && 'Você escreve as respostas; a correção é pelos pontos de acerto (autocorreção) ou pela IA.'}
              {cfg.answerFormat === 'original' && 'Cada pergunta aparece como foi cadastrada: múltipla escolha quando é objetiva, escrita quando é discursiva.'}
            </p>
          </Section>

          <Section title={`Quantidade: ${count} ${count === 1 ? 'questão' : 'questões'}`} hint={src.loading ? 'calculando…' : `${available} disponíveis com esses filtros`}>
            <input
              type="range"
              min={1}
              max={Math.max(1, Math.min(100, available))}
              value={count}
              onChange={(e) => set('count', Number(e.target.value))}
              className="w-full accent-brand-600"
              aria-label="Quantidade de questões"
            />
          </Section>

          <Section title="Tempo limite">
            {isProva ? (
              <div className="flex flex-wrap items-center gap-2">
                <Chip active={autoTime} onClick={() => setAutoTime(true)}>
                  Automático ({estMin} min)
                </Chip>
                <Chip active={!autoTime} onClick={() => setAutoTime(false)}>
                  Personalizado
                </Chip>
                {!autoTime && <MinutesInput value={cfg.timeLimitMin ?? 30} onChange={(v) => set('timeLimitMin', v)} />}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Chip active={cfg.timeLimitMin === null} onClick={() => set('timeLimitMin', null)}>
                  Sem limite (só cronometra)
                </Chip>
                <Chip active={cfg.timeLimitMin !== null} onClick={() => set('timeLimitMin', estMin)}>
                  Com limite
                </Chip>
                {cfg.timeLimitMin !== null && <MinutesInput value={cfg.timeLimitMin} onChange={(v) => set('timeLimitMin', v)} />}
              </div>
            )}
            <p className="mt-2 text-xs text-muted">O tempo de cada questão e do simulado completo é sempre registrado.</p>
          </Section>

          {!isProva && (
            <Section title="Correção e ajuda">
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle
                  checked={cfg.reveal === 'imediato'}
                  onChange={(v) => set('reveal', v ? 'imediato' : 'final')}
                  icon={cfg.reveal === 'imediato' ? Eye : EyeOff}
                  title="Revelar a cada questão"
                  text={cfg.reveal === 'imediato' ? 'Confere a resposta logo após responder.' : 'Gabarito só no final.'}
                />
                <Toggle checked={cfg.aiHints} onChange={(v) => set('aiHints', v)} icon={BrainCircuit} title="Dicas com IA" text="Explica por que cada alternativa está certa ou errada." />
                <Toggle checked={cfg.prioritizeMistakes} onChange={(v) => set('prioritizeMistakes', v)} icon={History} title="Priorizar o que errei" text="Puxa primeiro questões do caderno de erros." />
              </div>
            </Section>
          )}
        </div>

        {/* Resumo */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Resumo</h2>
              <Badge tone={isProva ? 'brand' : 'neutral'}>{isProva ? 'Prova' : 'Treino'}</Badge>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Questões" value={`${count} de ${available}`} />
              <Row label="Tempo" value={timeLimit ? `${timeLimit} min` : 'livre'} />
              <Row label="Gabarito" value={isProva || cfg.reveal === 'final' ? 'ao final' : 'a cada questão'} />
              <Row label="Dicas IA" value={!isProva && cfg.aiHints ? 'sim' : 'não'} />
              <Row label="Multiplicador" value={`×${MODE_MULTIPLIER[cfg.mode]}`} />
            </dl>
            <div className="mt-4 rounded-xl bg-gold-50 p-3 text-sm">
              Vale até <b className="font-display text-gold-600">{maxPoints.toLocaleString('pt-BR')} pts</b>
              {isProva && <span className="block text-xs text-muted">+ bônus de até 20% por tempo sobrando</span>}
            </div>
            {provaTooShort && (
              <p className="mt-3 flex gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">
                <Lock size={14} className="shrink-0" /> Provas com menos de {PROVA_RULES.minQuestions} questões não contam para o ranking.
              </p>
            )}
            <Button size="lg" className="mt-4 w-full" disabled={!available || src.starting || src.loading} onClick={start}>
              <Play size={18} /> {src.starting ? 'Sorteando…' : 'Começar'}
            </Button>
            {!available && !src.loading && <p className="mt-2 text-center text-xs text-rose-600">Nenhuma questão com esses filtros.</p>}
            {src.error && (
              <p role="alert" className="mt-2 text-center text-xs text-rose-600">
                {src.error}
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* Histórico */}
      <Card className="mt-8 p-5">
        <h2 className="mb-3 font-bold">Histórico</h2>
        {src.history.length === 0 && <p className="text-sm text-muted">Nenhum simulado ainda — monte o primeiro acima.</p>}
        <ul className="divide-y divide-line">
          {src.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Badge tone={h.mode === 'prova' ? 'brand' : 'neutral'}>{h.mode}</Badge>
              <span className="min-w-0 flex-1 font-bold">{h.title}</span>
              <span className="text-muted">{h.detail}</span>
              {h.points != null && <span className="font-display font-bold text-brand-700">+{h.points} pts</span>}
              {h.href && (
                <Link className="text-xs font-bold text-brand-600 hover:underline" to={h.href}>
                  {h.cta}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function ModeCard({ active, onClick, icon: Icon, title, mult, items }: { active: boolean; onClick: () => void; icon: typeof Repeat; title: string; mult: string; items: string[] }) {
  return (
    <button onClick={onClick} className={clsx('card p-5 text-left transition', active ? 'border-brand-500 ring-4 ring-brand-100' : 'hover:border-brand-200')}>
      <div className="flex items-center justify-between">
        <span className={clsx('rounded-xl p-2.5', active ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600')}>
          <Icon size={20} />
        </span>
        <Badge tone="gold">{mult}</Badge>
      </div>
      <p className="mt-3 font-display text-lg font-bold">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-muted">
        {items.map((i) => (
          <li key={i}>• {i}</li>
        ))}
      </ul>
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </Card>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-bold transition',
        active ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink hover:border-brand-300',
      )}
    >
      {children}
    </button>
  )
}

function Toggle({ checked, onChange, icon: Icon, title, text }: { checked: boolean; onChange: (v: boolean) => void; icon: typeof Eye; title: string; text: string }) {
  return (
    <button onClick={() => onChange(!checked)} aria-pressed={checked} className={clsx('flex items-start gap-3 rounded-xl border p-3 text-left transition', checked ? 'border-brand-300 bg-brand-50' : 'border-line bg-white')}>
      <Icon size={18} className={checked ? 'text-brand-600' : 'text-muted'} />
      <span className="flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      <span className={clsx('relative mt-0.5 h-5 w-9 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </span>
    </button>
  )
}

function MinutesInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <input type="number" min={1} max={600} value={value} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))} className="w-20 rounded-xl border border-line px-3 py-1.5" />
      min
    </span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  )
}
