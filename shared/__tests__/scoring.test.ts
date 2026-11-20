import { describe, expect, it } from 'vitest'
import { performanceGrade, scoreQuestion, scoreSimulado, type QuestionScoreInput } from '../scoring'

const q = (over: Partial<QuestionScoreInput> & { score: number | null }): QuestionScoreInput => ({
  answer: { score: over.score, gradedBy: 'auto', ...over.answer },
  difficulty: over.difficulty ?? 'media',
  mode: over.mode ?? 'treino',
  isOwnQuestion: over.isOwnQuestion ?? false,
  repeatedRecently: over.repeatedRecently ?? false,
})

describe('scoreQuestion', () => {
  it('prova vale 3× o treino', () => {
    expect(scoreQuestion(q({ score: 1, mode: 'treino' }))).toBe(15)
    expect(scoreQuestion(q({ score: 1, mode: 'prova' }))).toBe(45)
  })

  it('erro não pontua e não é negativo', () => {
    expect(scoreQuestion(q({ score: 0 }))).toBe(0)
    expect(scoreQuestion(q({ score: null }))).toBe(0)
  })

  it('aplica regras anti-farm', () => {
    expect(scoreQuestion(q({ score: 1, isOwnQuestion: true }))).toBe(7.5)
    expect(scoreQuestion(q({ score: 1, repeatedRecently: true }))).toBe(3.75)
  })

  it('treino: ver a resposta antes zera; dica corta pela metade', () => {
    expect(scoreQuestion(q({ score: 1, answer: { score: 1, revealedBeforeAnswer: true } }))).toBe(0)
    expect(scoreQuestion(q({ score: 1, answer: { score: 1, usedHint: true } }))).toBe(7.5)
  })

  it('autocorreção (checklist) vale metade da correção por IA', () => {
    const base = { score: 1 }
    expect(scoreQuestion(q({ score: 1, answer: { ...base, gradedBy: 'checklist' } }))).toBe(7.5)
    expect(scoreQuestion(q({ score: 1, answer: { ...base, gradedBy: 'ia' } }))).toBe(15)
  })
})

describe('scoreSimulado', () => {
  it('bônus de tempo só na prova e proporcional à acurácia', () => {
    const questions = Array.from({ length: 10 }, () => q({ score: 1, mode: 'prova' }))
    const r = scoreSimulado({ mode: 'prova', questions, timeLimitMs: 100_000, totalTimeMs: 50_000 })
    expect(r.base).toBe(450)
    expect(r.timeBonus).toBe(45) // 450 × 0,2 × 0,5 × 1,0
    expect(r.countsForRanking).toBe(true)
  })

  it('prova com menos de 10 questões não conta para o ranking', () => {
    const r = scoreSimulado({ mode: 'prova', questions: [q({ score: 1, mode: 'prova' })], timeLimitMs: 60_000, totalTimeMs: 1 })
    expect(r.countsForRanking).toBe(false)
  })
})

describe('performanceGrade', () => {
  it('pondera prova em dobro', () => {
    expect(performanceGrade([{ score: 1, mode: 'prova' }, { score: 0, mode: 'treino' }])).toBe(6.7)
  })
})
