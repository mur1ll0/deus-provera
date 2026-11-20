import type { Area, Discipline, RankingEntry } from '@shared/domain'

/**
 * Dados FICTÍCIOS para o protótipo de layout. Nada aqui vai para produção.
 * O usuário atual é "u-me". Questões de outros donos simulam a "comunidade".
 */

export const ME = {
  id: 'u-me',
  name: 'Estudante Demo',
  email: 'estudante.demo@exemplo.com',
  institution: 'Medicina · 6º período',
  avatarSeed: 'ED',
}

export const AREAS: Area[] = [
  { id: 'a-med', name: 'Medicina' },
  { id: 'a-mat', name: 'Matemática' },
  { id: 'a-psi', name: 'Psicologia' },
]

export const DISCIPLINES: Discipline[] = [
  { id: 'd-gin', areaId: 'a-med', name: 'Ginecologia' },
  { id: 'd-card', areaId: 'a-med', name: 'Cardiologia' },
  { id: 'd-calc', areaId: 'a-mat', name: 'Cálculo' },
  { id: 'd-dev', areaId: 'a-psi', name: 'Psicologia do Desenvolvimento' },
]

export { GROUPS, QUESTIONS } from './questions'

export const RANKING: RankingEntry[] = [
  { userId: 'u-2', name: 'Ana Beatriz L.', avatarSeed: 'AB', institution: 'Medicina · UESPI', points: 4820, grade: 8.9, simulados: 41 },
  { userId: 'u-3', name: 'Rafael M.', avatarSeed: 'RM', institution: 'Medicina · UFPI', points: 4410, grade: 8.4, simulados: 38 },
  { userId: 'u-4', name: 'Júlia C.', avatarSeed: 'JC', institution: 'Enfermagem · UFPI', points: 3975, grade: 8.7, simulados: 29 },
  { userId: 'u-me', name: 'Estudante Demo', avatarSeed: 'ED', institution: 'Medicina · 6º período', points: 3620, grade: 7.8, simulados: 27 },
  { userId: 'u-5', name: 'Pedro H.', avatarSeed: 'PH', institution: 'Engenharia · IFPI', points: 3390, grade: 7.2, simulados: 33 },
  { userId: 'u-6', name: 'Mariana S.', avatarSeed: 'MS', institution: 'Psicologia · UESPI', points: 3105, grade: 8.1, simulados: 22 },
  { userId: 'u-7', name: 'Gabriel T.', avatarSeed: 'GT', institution: 'Medicina · UESPI', points: 2870, grade: 6.9, simulados: 25 },
  { userId: 'u-8', name: 'Larissa F.', avatarSeed: 'LF', institution: 'Medicina · FACID', points: 2540, grade: 7.5, simulados: 18 },
  { userId: 'u-9', name: 'Thiago A.', avatarSeed: 'TA', institution: 'Direito · UFPI', points: 2210, grade: 6.6, simulados: 20 },
  { userId: 'u-10', name: 'Camila R.', avatarSeed: 'CR', institution: 'Medicina · UFPI', points: 1980, grade: 7.0, simulados: 14 },
  { userId: 'u-11', name: 'Bruno N.', avatarSeed: 'BN', institution: 'Matemática · UFPI', points: 1655, grade: 6.2, simulados: 16 },
  { userId: 'u-12', name: 'Isabela P.', avatarSeed: 'IP', institution: 'Fisioterapia · UESPI', points: 1320, grade: 7.3, simulados: 9 },
]

/** Histórico fictício do usuário para o dashboard. */
export const MY_HISTORY = [
  { id: 'h-1', date: '2026-11-18', mode: 'prova' as const, title: 'Ginecologia · Prova II unidade', questions: 20, accuracy: 0.8, points: 612, timeMin: 38 },
  { id: 'h-2', date: '2026-11-17', mode: 'treino' as const, title: 'Prolapso genital', questions: 10, accuracy: 0.7, points: 98, timeMin: 16 },
  { id: 'h-3', date: '2026-11-15', mode: 'treino' as const, title: 'HPV e lesões precursoras', questions: 12, accuracy: 0.58, points: 104, timeMin: 21 },
  { id: 'h-4', date: '2026-11-13', mode: 'prova' as const, title: 'Medicina · Misto', questions: 30, accuracy: 0.73, points: 845, timeMin: 52 },
  { id: 'h-5', date: '2026-11-10', mode: 'treino' as const, title: 'Integrais', questions: 8, accuracy: 0.88, points: 92, timeMin: 11 },
  { id: 'h-6', date: '2026-11-08', mode: 'treino' as const, title: 'Incontinência urinária', questions: 10, accuracy: 0.6, points: 81, timeMin: 19 },
  { id: 'h-7', date: '2026-11-05', mode: 'prova' as const, title: 'Ginecologia · Revisão', questions: 15, accuracy: 0.67, points: 401, timeMin: 30 },
]

/** Desempenho por assunto (para o mapa do dashboard). */
export const TOPIC_PERFORMANCE = [
  { topic: 'Prolapso genital', discipline: 'Ginecologia', accuracy: 0.74, answered: 46 },
  { topic: 'Incontinência urinária', discipline: 'Ginecologia', accuracy: 0.61, answered: 38 },
  { topic: 'HPV e lesões precursoras', discipline: 'Ginecologia', accuracy: 0.55, answered: 52 },
  { topic: 'Endometriose', discipline: 'Ginecologia', accuracy: 0.82, answered: 22 },
  { topic: 'Climatério', discipline: 'Ginecologia', accuracy: 0.69, answered: 17 },
  { topic: 'Integrais', discipline: 'Cálculo', accuracy: 0.88, answered: 24 },
]

/** Questões respondidas por dia nas últimas 4 semanas (mais antigo → mais recente). */
export const ACTIVITY_28D = [0, 4, 12, 0, 8, 20, 0, 6, 0, 15, 10, 0, 0, 12, 30, 5, 0, 9, 14, 0, 7, 0, 22, 18, 0, 11, 10, 20]
