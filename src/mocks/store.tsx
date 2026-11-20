import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Area, Discipline, Id, Question, QuestionGroup, SimuladoAttempt, SimuladoConfig } from '@shared/domain'
import { AREAS, DISCIPLINES, GROUPS, ME, QUESTIONS } from './data'
import { isEligible, norm, uid, type DraftQuestion, type ImportCard } from './model'

/**
 * Store do PROTÓTIPO: estado em memória + localStorage.
 * No produto real, cada ação abaixo vira uma chamada à API (server/routes/*).
 */

// v2: questão = enunciado + perguntas (dados da v1 são descartados)
const STORAGE_KEY = 'deus-provera:mock:v2'

interface PersistedState {
  loggedIn: boolean
  areas: Area[]
  disciplines: Discipline[]
  groups: QuestionGroup[]
  questions: Question[]
  attempts: SimuladoAttempt[]
}

const initialState = (): PersistedState => ({
  loggedIn: false,
  areas: AREAS,
  disciplines: DISCIPLINES,
  groups: GROUPS,
  questions: QUESTIONS,
  attempts: [],
})

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...initialState(), ...JSON.parse(raw) }
  } catch {
    /* storage indisponível: segue em memória */
  }
  return initialState()
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface StoreApi extends PersistedState {
  me: typeof ME
  login: () => void
  logout: () => void
  resetDemo: () => void
  commitImport: (cards: ImportCard[], drafts: Record<Id, DraftQuestion>) => number
  updateQuestion: (q: Question) => void
  deleteQuestion: (id: Id) => void
  poolFor: (config: SimuladoConfig) => Question[]
  startSimulado: (config: SimuladoConfig) => SimuladoAttempt | null
  saveAttempt: (a: SimuladoAttempt) => void
  areaName: (id: Id) => string
  disciplineName: (id: Id) => string
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* ignora */
    }
  }, [state])

  const login = useCallback(() => setState((s) => ({ ...s, loggedIn: true })), [])
  const logout = useCallback(() => setState((s) => ({ ...s, loggedIn: false })), [])
  const resetDemo = useCallback(() => setState({ ...initialState(), loggedIn: true }), [])

  const commitImport = useCallback((cards: ImportCard[], drafts: Record<Id, DraftQuestion>) => {
    let saved = 0
    setState((s) => {
      const areas = [...s.areas]
      const disciplines = [...s.disciplines]
      const groups: QuestionGroup[] = []
      const questions: Question[] = []
      const now = new Date().toISOString()
      for (const card of cards) {
        if (!card.questionIds.length) continue
        let area = areas.find((a) => norm(a.name) === norm(card.area))
        if (!area) areas.push((area = { id: uid('a'), name: card.area.trim() }))
        let disc = disciplines.find((d) => d.areaId === area!.id && norm(d.name) === norm(card.discipline))
        if (!disc) disciplines.push((disc = { id: uid('d'), areaId: area.id, name: card.discipline.trim() }))
        const group: QuestionGroup = {
          id: uid('g'),
          ownerId: ME.id,
          areaId: area.id,
          disciplineId: disc.id,
          topic: card.topic.trim() || undefined,
          description: card.description.trim() || undefined,
        }
        groups.push(group)
        for (const qid of card.questionIds) {
          const d = drafts[qid]
          if (!d) continue
          questions.push({
            ...d,
            id: uid('q'),
            ownerId: ME.id,
            groupId: group.id,
            areaId: area.id,
            disciplineId: disc.id,
            topic: group.topic,
            createdAt: now,
          })
        }
      }
      saved = questions.length
      return { ...s, areas, disciplines, groups: [...s.groups, ...groups], questions: [...s.questions, ...questions] }
    })
    return saved
  }, [])

  const updateQuestion = useCallback((q: Question) => {
    setState((s) => ({ ...s, questions: s.questions.map((x) => (x.id === q.id ? q : x)) }))
  }, [])

  const deleteQuestion = useCallback((id: Id) => {
    setState((s) => ({ ...s, questions: s.questions.filter((x) => x.id !== id) }))
  }, [])

  const poolFor = useCallback(
    (c: SimuladoConfig) =>
      state.questions.filter((q) => {
        if (c.scope === 'minhas' && q.ownerId !== ME.id) return false
        if (c.scope === 'minhas_e_comunidade' && q.ownerId !== ME.id && q.visibility !== 'publica') return false
        if (c.areaId && q.areaId !== c.areaId) return false
        if (c.disciplineIds.length && !c.disciplineIds.includes(q.disciplineId)) return false
        if (c.topics.length && !c.topics.includes(q.topic ?? '')) return false
        return isEligible(q, c.answerFormat)
      }),
    [state.questions],
  )

  const startSimulado = useCallback(
    (config: SimuladoConfig) => {
      const pool = poolFor(config)
      if (!pool.length) return null
      // Cada questão leva junto todas as suas perguntas (enunciado + subitens).
      const picked = shuffle(pool).slice(0, config.count)
      const attempt: SimuladoAttempt = {
        id: uid('sim'),
        userId: ME.id,
        config,
        questionIds: picked.map((q) => q.id),
        answers: {},
        timeMs: {},
        flagged: [],
        startedAt: new Date().toISOString(),
        totalTimeMs: 0,
      }
      setState((s) => ({ ...s, attempts: [...s.attempts, attempt] }))
      return attempt
    },
    [poolFor],
  )

  const saveAttempt = useCallback((a: SimuladoAttempt) => {
    setState((s) => ({ ...s, attempts: s.attempts.map((x) => (x.id === a.id ? a : x)) }))
  }, [])

  const areaName = useCallback((id: Id) => state.areas.find((a) => a.id === id)?.name ?? '—', [state.areas])
  const disciplineName = useCallback((id: Id) => state.disciplines.find((d) => d.id === id)?.name ?? '—', [state.disciplines])

  const api = useMemo<StoreApi>(
    () => ({
      ...state,
      me: ME,
      login,
      logout,
      resetDemo,
      commitImport,
      updateQuestion,
      deleteQuestion,
      poolFor,
      startSimulado,
      saveAttempt,
      areaName,
      disciplineName,
    }),
    [state, login, logout, resetDemo, commitImport, updateQuestion, deleteQuestion, poolFor, startSimulado, saveAttempt, areaName, disciplineName],
  )

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): StoreApi {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore fora do StoreProvider')
  return ctx
}
