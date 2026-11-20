/**
 * Tipos de domínio compartilhados entre frontend (src/) e backend (server/).
 * Fonte da verdade conceitual: docs/06-modelo-de-dados.md
 *
 * Taxonomia: Área (ex.: Medicina) → Disciplina (ex.: Ginecologia) → Assunto (ex.: Prolapso genital)
 *
 * Estrutura de uma questão (como nas provas reais):
 *   Questão = ENUNCIADO (caso clínico / texto-base / comando)
 *             + 1..N PERGUNTAS (subitens a, b, c… ou uma "pergunta única")
 *   Cada pergunta tem a própria resposta: discursiva (resposta esperada + pontos-chave)
 *   e/ou múltipla escolha (alternativas — informadas ou geradas por IA).
 */

export type Id = string

/** Forma de responder uma pergunta. */
export type AnswerKind = 'objetiva' | 'discursiva'
/** @deprecated use AnswerKind */
export type QuestionType = AnswerKind
export type Difficulty = 'facil' | 'media' | 'dificil'
export type Visibility = 'privada' | 'publica'
export type QuestionOrigin = 'pdf_ia' | 'agente_externo' | 'manual'
export type ContentSource = 'usuario' | 'ia'

export interface Area {
  id: Id
  name: string
}

export interface Discipline {
  id: Id
  areaId: Id
  name: string
}

/** "Card" da tela de revisão: agrupa questões por Área + Disciplina (+ Assunto) com descrição livre. */
export interface QuestionGroup {
  id: Id
  ownerId: Id
  areaId: Id
  disciplineId: Id
  topic?: string
  description?: string
}

export interface Alternative {
  id: Id
  text: string
  correct: boolean
  /** Por que está certa/errada (pode vir do usuário ou ser gerada pela IA). */
  explanation?: string
  source: ContentSource
}

/** Uma pergunta da questão — cada uma espera a sua resposta. */
export interface QuestionItem {
  id: Id
  /** "a", "b", "1"… — ausente na pergunta única (quando o enunciado já é a pergunta). */
  label?: string
  /** Texto da pergunta. Vazio na pergunta única. */
  prompt: string
  /** Tipo ORIGINAL da resposta: discursiva (texto) ou objetiva (alternativas no material). */
  type: AnswerKind
  /** Resposta esperada (discursiva) ou comentário do gabarito (objetiva). */
  expectedAnswer?: string
  /** Pontos de acerto para corrigir respostas discursivas (checklist / IA). */
  keyPoints?: string[]
  /** Alternativas: originais (objetiva) ou geradas por IA a partir da resposta esperada. */
  alternatives?: Alternative[]
}

export interface Question {
  id: Id
  ownerId: Id
  groupId: Id
  areaId: Id
  disciplineId: Id
  topic?: string
  /** Rótulo no material de origem (ex.: "QUESTÃO 8"). */
  sourceLabel?: string
  /** ENUNCIADO: caso clínico / texto-base / comando principal. */
  stem: string
  /** Perguntas (≥ 1). */
  items: QuestionItem[]
  difficulty: Difficulty
  visibility: Visibility
  origin: QuestionOrigin
  hasImage?: boolean
  imageDescription?: string
  /** Sinalizações do guardrail ou da validação (ex.: "conteúdo suspeito removido"). */
  flags?: string[]
  createdAt: string
}

export type SimuladoMode = 'prova' | 'treino'
export type RevealMode = 'imediato' | 'final'
export type QuestionSourceScope = 'minhas' | 'minhas_e_comunidade'
/**
 * Formato de resposta no simulado:
 *  - original: cada pergunta como foi cadastrada;
 *  - multipla: tudo em múltipla escolha (só questões cujas perguntas têm alternativas);
 *  - discursiva: responder por escrito (perguntas só objetivas continuam objetivas).
 */
export type AnswerFormat = 'original' | 'multipla' | 'discursiva'

export interface SimuladoConfig {
  mode: SimuladoMode
  scope: QuestionSourceScope
  areaId: Id | null
  disciplineIds: Id[]
  topics: string[]
  answerFormat: AnswerFormat
  /** Quantidade de QUESTÕES (enunciados). */
  count: number
  /** Tempo limite total em minutos (null = sem limite; obrigatório no modo prova). */
  timeLimitMin: number | null
  reveal: RevealMode
  aiHints: boolean
  prioritizeMistakes: boolean
}

/** Resposta a UMA pergunta. */
export interface ItemAnswer {
  itemId: Id
  /** Objetiva: id da alternativa escolhida. */
  choiceId?: Id
  /** Discursiva: texto escrito pelo estudante. */
  text?: string
  /** 0..1 — fração de acerto (objetiva: 0 ou 1; discursiva: checklist/IA). null = não corrigida. */
  score: number | null
  gradedBy?: 'auto' | 'checklist' | 'ia'
  revealedBeforeAnswer?: boolean
  usedHint?: boolean
}
/** @deprecated use ItemAnswer */
export type AnswerRecord = ItemAnswer

export interface SimuladoAttempt {
  id: Id
  userId: Id
  config: SimuladoConfig
  questionIds: Id[]
  /** Respostas por PERGUNTA (itemId). */
  answers: Record<Id, ItemAnswer>
  /** Tempo gasto por QUESTÃO (enunciado + suas perguntas). */
  timeMs: Record<Id, number>
  flagged: Id[]
  startedAt: string
  finishedAt?: string
  totalTimeMs: number
  points?: number
}

export interface RankingEntry {
  userId: Id
  name: string
  avatarSeed: string
  institution?: string
  points: number
  grade: number
  simulados: number
}
