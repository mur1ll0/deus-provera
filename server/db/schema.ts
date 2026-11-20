import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Schema do banco (Neon Postgres + Drizzle). Documentação: docs/06-modelo-de-dados.md
 *
 * Convenções: ids uuid (exceto tabelas do Better Auth, que usam text), timestamps com fuso,
 * soft-delete via deleted_at em conteúdo do usuário.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true })
const createdAt = ts('created_at').notNull().defaultNow()
const updatedAt = ts('updated_at').notNull().defaultNow()

/* ============================ Better Auth ============================ */
// Mantidas compatíveis com o schema core do Better Auth (gerar/validar com `npx auth@latest generate`).

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt,
  updatedAt,
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt,
  updatedAt,
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt,
  updatedAt,
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt,
  updatedAt,
})

/* ============================ Perfil ============================ */

export const profile = pgTable('profile', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  institution: text('institution'),
  course: text('course'),
  /** Aparecer no ranking público (LGPD: opt-out disponível). */
  showInRanking: boolean('show_in_ranking').notNull().default(true),
  /** Chave OpenRouter própria (BYOK), cifrada — opcional, fase 3. */
  openrouterKeyEnc: text('openrouter_key_enc'),
  /** Ciência do aviso de privacidade (FR-013). */
  privacyAckAt: ts('privacy_ack_at'),
  /** Aviso único do ranking já exibido (FR-006). */
  onboardedAt: ts('onboarded_at'),
  createdAt,
  updatedAt,
})

/* ============================ Taxonomia ============================ */

export const area = pgTable('area', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt,
})

export const discipline = pgTable(
  'discipline',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    areaId: uuid('area_id').notNull().references(() => area.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt,
  },
  (t) => [uniqueIndex('discipline_area_slug').on(t.areaId, t.slug)],
)

/** "Card" da revisão: Área › Disciplina · Assunto + descrição, por dono. */
export const questionGroup = pgTable(
  'question_group',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    areaId: uuid('area_id').notNull().references(() => area.id),
    disciplineId: uuid('discipline_id').notNull().references(() => discipline.id),
    topic: text('topic'),
    description: text('description'),
    createdAt,
    updatedAt,
  },
  (t) => [index('qgroup_owner').on(t.ownerId)],
)

/* ============================ Questões ============================ */

export const questionType = pgEnum('question_type', ['objetiva', 'discursiva'])
export const difficulty = pgEnum('difficulty', ['facil', 'media', 'dificil'])
export const visibility = pgEnum('visibility', ['privada', 'publica'])
export const origin = pgEnum('question_origin', ['pdf_ia', 'agente_externo', 'manual'])
export const contentSource = pgEnum('content_source', ['usuario', 'ia'])

/** Questão = ENUNCIADO (caso clínico / texto-base / comando) + 1..N PERGUNTAS (question_item). */
export const question = pgTable(
  'question',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull().references(() => questionGroup.id),
    areaId: uuid('area_id').notNull().references(() => area.id),
    disciplineId: uuid('discipline_id').notNull().references(() => discipline.id),
    topic: text('topic'),
    /** Rótulo no material de origem (ex.: "QUESTÃO 8"). */
    sourceLabel: text('source_label'),
    /** ENUNCIADO */
    stem: text('stem').notNull(),
    summary: text('summary'),
    difficulty: difficulty('difficulty').notNull().default('media'),
    visibility: visibility('visibility').notNull().default('privada'),
    origin: origin('origin').notNull(),
    hasImage: boolean('has_image').notNull().default(false),
    imageDescription: text('image_description'),
    /** Hash do conteúdo normalizado (enunciado + perguntas) para detectar duplicatas entre importações. */
    contentHash: text('content_hash').notNull(),
    flags: jsonb('flags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Estatística agregada (atualizada ao finalizar simulados) — acelera filtros por dificuldade real. */
    timesAnswered: integer('times_answered').notNull().default(0),
    timesCorrect: real('times_correct').notNull().default(0),
    createdAt,
    updatedAt,
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('question_owner').on(t.ownerId),
    index('question_filter').on(t.visibility, t.areaId, t.disciplineId),
    index('question_topic').on(t.disciplineId, t.topic),
    // Parcial: uma questão excluída (soft-delete) não impede recadastrar o mesmo conteúdo.
    uniqueIndex('question_owner_hash').on(t.ownerId, t.contentHash).where(sql`deleted_at is null`),
  ],
)

/** PERGUNTA de uma questão (subitem a, b, c… ou pergunta única) — cada uma com a sua resposta. */
export const questionItem = pgTable(
  'question_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id').notNull().references(() => question.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** "a", "b", "1"… (null na pergunta única) */
    label: text('label'),
    /** Texto da pergunta ('' na pergunta única) */
    prompt: text('prompt').notNull().default(''),
    /** Tipo ORIGINAL da resposta */
    type: questionType('type').notNull(),
    expectedAnswer: text('expected_answer'),
    keyPoints: jsonb('key_points').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [index('item_question').on(t.questionId, t.position)],
)

export const alternative = pgTable(
  'alternative',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id').notNull().references(() => questionItem.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    correct: boolean('correct').notNull(),
    explanation: text('explanation'),
    source: contentSource('source').notNull().default('usuario'),
  },
  (t) => [index('alternative_item').on(t.itemId)],
)

/* ============================ Importação ============================ */

export const importStatus = pgEnum('import_status', ['rascunho', 'processando', 'revisao', 'concluida', 'falhou', 'cancelada'])

/**
 * Job de importação. O pipeline de IA roda em passos idempotentes (≤ 300 s cada na Vercel);
 * o estado do grafo fica em `state` (checkpoint), permitindo retomar após falha/timeout.
 */
export const importJob = pgTable(
  'import_job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    source: origin('source').notNull(),
    fileName: text('file_name'),
    status: importStatus('status').notNull().default('rascunho'),
    /** Checkpoint do grafo: nó atual, lotes pendentes, rascunhos, cards, erros. */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    guardrailRisk: text('guardrail_risk'),
    aiRequests: integer('ai_requests').notNull().default(0),
    error: text('error'),
    createdAt,
    updatedAt,
  },
  (t) => [index('import_owner').on(t.ownerId, t.createdAt)],
)

/* ============================ Simulados ============================ */

export const simuladoMode = pgEnum('simulado_mode', ['prova', 'treino'])

export const attempt = pgTable(
  'attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    mode: simuladoMode('mode').notNull(),
    /** SimuladoConfig completo (shared/domain.ts). */
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    questionIds: jsonb('question_ids').$type<string[]>().notNull(),
    timeLimitMs: integer('time_limit_ms'),
    startedAt: ts('started_at').notNull().defaultNow(),
    /** Prazo calculado no servidor (prova): respostas após o prazo são ignoradas. */
    deadlineAt: ts('deadline_at'),
    finishedAt: ts('finished_at'),
    /** Fechada automaticamente após 24 h em andamento (cron diário — spec 003 › T032): não pontua. */
    abandonedAt: ts('abandoned_at'),
    totalTimeMs: integer('total_time_ms'),
    accuracy: real('accuracy'),
    points: integer('points'),
    countsForRanking: boolean('counts_for_ranking').notNull().default(false),
    /** Pontuação detalhada gravada ao finalizar/corrigir (shared/scoring.ts › SimuladoScore + pendentes). */
    scoreDetail: jsonb('score_detail').$type<{ base: number; timeBonus: number; total: number; accuracy: number; countsForRanking: boolean; pending: number }>(),
  },
  (t) => [index('attempt_user').on(t.userId, t.startedAt)],
)

export const graderKind = pgEnum('grader_kind', ['auto', 'checklist', 'ia'])

/** Tempo e marcação por QUESTÃO (enunciado + perguntas) dentro da tentativa. */
export const attemptQuestion = pgTable(
  'attempt_question',
  {
    attemptId: uuid('attempt_id').notNull().references(() => attempt.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id').notNull().references(() => question.id),
    position: integer('position').notNull(),
    timeMs: integer('time_ms').notNull().default(0),
    flagged: boolean('flagged').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.questionId] })],
)

/** Resposta a uma PERGUNTA (unidade de correção e pontuação). */
export const attemptAnswer = pgTable(
  'attempt_answer',
  {
    attemptId: uuid('attempt_id').notNull().references(() => attempt.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull().references(() => questionItem.id),
    questionId: uuid('question_id').notNull().references(() => question.id),
    /** Como foi apresentada (formato de resposta do simulado). */
    presentedAs: questionType('presented_as').notNull(),
    choiceId: uuid('choice_id').references(() => alternative.id),
    text: text('text'),
    score: real('score'),
    gradedBy: graderKind('graded_by'),
    revealedBeforeAnswer: boolean('revealed_before_answer').notNull().default(false),
    usedHint: boolean('used_hint').notNull().default(false),
    answeredAt: ts('answered_at'),
    /** Treino com revelação imediata: gabarito mostrado — a resposta fica travada. */
    revealedAt: ts('revealed_at'),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.itemId] }), index('answer_item').on(t.itemId), index('answer_question').on(t.questionId)],
)

/* ============================ Pontos e ranking ============================ */

/**
 * Livro-razão de pontos (append-only). O ranking é agregação sobre esta tabela,
 * o que permite rankings por período (semana/mês/geral) e por área sem recalcular simulados.
 */
export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => attempt.id, { onDelete: 'set null' }),
    areaId: uuid('area_id').references(() => area.id),
    points: integer('points').notNull(),
    reason: text('reason').notNull(),
    createdAt,
  },
  (t) => [
    index('ledger_period').on(t.createdAt, t.userId),
    index('ledger_user').on(t.userId),
    // Um lançamento por motivo e tentativa ("simulado:prova", "ajuste:correcao:<itemId>"): finish/correção idempotentes.
    uniqueIndex('ledger_attempt_reason').on(t.attemptId, t.reason),
  ],
)

/* ============================ IA ============================ */

/**
 * Cache de respostas de IA reaproveitáveis entre usuários (ex.: explicação de uma questão pública).
 * Chave = hash(tarefa + versão do prompt + conteúdo). Economiza a cota diária de requisições gratuitas.
 */
export const aiCache = pgTable('ai_cache', {
  key: text('key').primaryKey(),
  task: text('task').notNull(),
  model: text('model').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  createdAt,
  expiresAt: ts('expires_at'),
})

/** Telemetria de chamadas (custo zero, mas cota limitada): base do circuit breaker por modelo. */
export const aiCall = pgTable(
  'ai_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    task: text('task').notNull(),
    model: text('model').notNull(),
    ok: boolean('ok').notNull(),
    errorKind: text('error_kind'),
    latencyMs: integer('latency_ms').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    createdAt,
  },
  (t) => [index('ai_call_day').on(t.createdAt), index('ai_call_model').on(t.model, t.createdAt)],
)
