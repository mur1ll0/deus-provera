import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { AnswerKind, SimuladoConfig } from '@shared/domain'
import { presentAs } from '@shared/simulado'
import { api, unwrap } from '@/lib/api'
import { formatDate, pct } from '@/lib/format'
import { MY_HISTORY } from '@/mocks/data'
import { useStore } from '@/mocks/store'
import { createRemote, listRemote, previewRemote } from './remote'

/** Linha do histórico de simulados (API real ou protótipo). */
export interface HistoryRow {
  id: string
  mode: 'prova' | 'treino'
  title: string
  detail: string
  points: number | null
  href?: string
  cta?: string
}

/**
 * Dados da tela de configuração (spec 003): taxonomia, prévia do sorteio (quantas questões, assuntos,
 * formato das perguntas para estimar o tempo), criação e histórico — da API real ou do store do protótipo.
 */
export function useSetupSource(cfg: SimuladoConfig, real: boolean) {
  const store = useStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: () => unwrap(api.taxonomy.index.$get()), enabled: real, staleTime: 5 * 60_000 })
  // A quantidade não entra na prévia: o slider não dispara requisições (o cliente fatia `kinds`).
  const previewCfg = { ...cfg, count: 100 }
  const preview = useQuery({
    queryKey: ['simulado-preview', previewCfg],
    queryFn: () => previewRemote(previewCfg),
    enabled: real,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
  const history = useQuery({ queryKey: ['simulados'], queryFn: listRemote, enabled: real })
  const create = useMutation({
    mutationFn: createRemote,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['simulados'] })
      navigate(`/simulados/${r.id}`)
    },
  })

  // Protótipo (store em memória)
  const localPool = useMemo(() => (real ? [] : store.poolFor(cfg)), [real, store, cfg])
  const localTopics = useMemo(
    () => (real ? [] : [...new Set(store.poolFor({ ...cfg, topics: [] }).map((q) => q.topic).filter(Boolean) as string[])].sort()),
    [real, store, cfg],
  )

  if (!real) {
    const rows: HistoryRow[] = [
      ...store.attempts
        .filter((a) => a.finishedAt)
        .reverse()
        .map((a) => ({ id: a.id, mode: a.config.mode, title: `Simulado de ${a.questionIds.length} questões`, detail: formatDate(a.startedAt), points: a.points ?? 0, href: `/simulados/${a.id}/resultado`, cta: 'ver gabarito' })),
      ...MY_HISTORY.map((h) => ({ id: h.id, mode: h.mode, title: h.title, detail: `${formatDate(h.date)} · ${h.questions} q · ${pct(h.accuracy)}`, points: h.points })),
    ]
    return {
      loading: false,
      error: null as string | null,
      areas: store.areas,
      disciplines: store.disciplines,
      topics: localTopics,
      available: localPool.length,
      kinds: (count: number): AnswerKind[] => localPool.slice(0, count).flatMap((q) => q.items.map((it) => presentAs(it, cfg.answerFormat))),
      start: (c: SimuladoConfig) => {
        const attempt = store.startSimulado(c)
        if (attempt) navigate(`/simulados/${attempt.id}`)
      },
      starting: false,
      history: rows,
    }
  }

  const rows: HistoryRow[] = (history.data?.items ?? []).map((h) => ({
    id: h.id,
    mode: h.mode,
    title: h.title,
    detail: `${formatDate(h.startedAt)}${h.status === 'finalizado' && h.accuracy != null ? ` · ${pct(h.accuracy)}` : ''}${h.status === 'em_andamento' ? ' · não finalizado' : h.status === 'abandonado' ? ' · abandonado (mais de 24 h sem finalizar)' : ''}`,
    points: h.status === 'finalizado' ? h.points : null,
    href: h.status === 'em_andamento' ? `/simulados/${h.id}` : `/simulados/${h.id}/resultado`,
    cta: h.status === 'em_andamento' ? 'continuar' : 'ver gabarito',
  }))
  return {
    loading: preview.isPending,
    error: (create.error ?? preview.error ?? taxonomy.error)?.message ?? null,
    areas: taxonomy.data?.areas ?? [],
    disciplines: taxonomy.data?.disciplines ?? [],
    topics: preview.data?.topics ?? [],
    available: preview.data?.available ?? 0,
    kinds: (count: number): AnswerKind[] => (preview.data?.kinds ?? []).slice(0, count).flat(),
    start: (c: SimuladoConfig) => create.mutate(c),
    starting: create.isPending,
    history: rows,
  }
}
