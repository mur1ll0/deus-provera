import type { DocumentGuide } from '@shared/document-guide'
import type { QuestionItem, Visibility } from '@shared/domain'
import { inspectText } from '@shared/guardrails'
import { cleanItemLabel, type ImportFile, type ImportQuestion } from '@shared/schemas/import'
import { heuristicKeyPoints, type SegmentedQuestion } from '@shared/segmenter'
import { tablesForDisplay } from '@shared/tables'
import { classifyQuestion } from '@/mocks/ai'
import { emptyItem, uid, type DraftQuestion, type ImportCard } from '@/mocks/model'
import type { ServerCard, ServerDraft } from './importJob'

export interface ReviewState {
  cards: ImportCard[]
  drafts: Record<string, DraftQuestion>
  source: 'pdf_ia' | 'agente_externo' | 'manual'
  fileName?: string
  /** Job no servidor (PDF); agente externo e lote manual criam o seu ao salvar. */
  jobId?: string
  /** JSON v2 do agente externo (revalidado no servidor ao criar o job — T023). */
  payload?: ImportFile
  /** Guia do documento (instruções, temas por questão) e avisos do processamento, exibidos na revisão. */
  notes?: ReviewNotes
}

export interface ReviewNotes {
  guide?: DocumentGuide
  /** Avisos do pipeline, sem repetição ("… (8×)"). */
  warnings: string[]
}

/** Avisos repetidos (um por lote) viram uma linha com a contagem. */
export function summarizeWarnings(warnings: string[] = []): string[] {
  const count = new Map<string, number>()
  for (const w of warnings) count.set(w, (count.get(w) ?? 0) + 1)
  return [...count].map(([w, n]) => (n > 1 ? `${w} (${n}×)` : w))
}

/** Aplica o guardrail em um campo e acumula as sinalizações. */
function guard(text: string | undefined | null, flags: Set<string>): string | undefined {
  if (!text) return undefined
  const r = inspectText(text)
  for (const f of r.findings) flags.add(`Guardrail: ${f.label}`)
  return r.clean
}

function upsertCard(cards: Map<string, ImportCard>, area: string, discipline: string, topic: string, qid: string) {
  const key = `${area}|${discipline}|${topic}`.toLocaleLowerCase('pt-BR')
  const card = cards.get(key) ?? { id: uid('card'), area, discipline, topic, description: '', questionIds: [] }
  card.questionIds.push(qid)
  cards.set(key, card)
}

/** PDF → segmentos determinísticos (enunciado + perguntas) → (no produto: LLM estrutura) → rascunhos + cards. */
export function draftsFromSegments(items: SegmentedQuestion[], visibility: Visibility, fileName: string): ReviewState {
  const drafts: Record<string, DraftQuestion> = {}
  const cards = new Map<string, ImportCard>()

  for (const seg of items) {
    const flags = new Set<string>()
    // POP-Q (linha canônica) → grade Markdown que a tela desenha (shared/tables.ts)
    const stem = tablesForDisplay(guard(seg.stem, flags) ?? seg.stem)
    const qItems: QuestionItem[] = seg.items.map((it) => {
      const guarded = guard(it.answer, flags)
      const answer = guarded ? tablesForDisplay(guarded) : guarded
      return {
        id: uid('it'),
        label: it.label,
        prompt: tablesForDisplay(guard(it.prompt, flags) ?? it.prompt),
        type: 'discursiva',
        expectedAnswer: answer,
        keyPoints: heuristicKeyPoints(answer),
      }
    })
    const missing = qItems.filter((i) => !i.expectedAnswer).length
    if (missing) flags.add(missing === qItems.length ? 'Resposta não encontrada — revise' : `${missing} pergunta(s) sem resposta — revise`)
    if (stem.length < 15) flags.add('Enunciado muito curto — revise')

    const id = uid('dq')
    drafts[id] = {
      id,
      sourceLabel: seg.sourceLabel,
      stem,
      items: qItems,
      difficulty: 'media',
      visibility,
      origin: 'pdf_ia',
      flags: [...flags],
    }
    const c = classifyQuestion(seg.section, stem, `${stem} ${qItems.map((i) => `${i.prompt} ${i.expectedAnswer ?? ''}`).join(' ')}`)
    upsertCard(cards, c.area, c.discipline, c.topic, id)
  }

  return { cards: describeCards([...cards.values()], drafts), drafts, source: 'pdf_ia', fileName }
}

/** Uma questão no contrato v2 → rascunho da revisão (guardrail reaplicado em todos os campos de texto). */
function draftFromImportQuestion(q: ImportQuestion, visibility: Visibility, origin: DraftQuestion['origin'], extraFlags: string[] = []): DraftQuestion {
  const flags = new Set<string>(extraFlags)
  return {
    id: uid('dq'),
    sourceLabel: q.rotulo ?? undefined,
    stem: guard(q.enunciado, flags) ?? q.enunciado,
    items: q.perguntas.map((p) => ({
      id: uid('it'),
      label: cleanItemLabel(p.rotulo) ?? undefined,
      prompt: guard(p.texto, flags) ?? p.texto,
      type: p.tipo,
      expectedAnswer: guard(p.resposta_esperada, flags),
      keyPoints: p.pontos_chave?.map((k) => guard(k, flags) ?? k),
      alternatives: p.alternativas?.map((a) => ({
        id: uid('alt'),
        text: guard(a.texto, flags) ?? a.texto,
        correct: a.correta,
        explanation: guard(a.explicacao, flags),
        source: a.gerada_por_ia ? ('ia' as const) : ('usuario' as const),
      })),
    })),
    difficulty: q.dificuldade ?? 'media',
    visibility,
    origin,
    hasImage: q.tem_imagem ?? undefined,
    imageDescription: guard(q.descricao_imagem, flags),
    flags: [...flags],
  }
}

/** JSON v2 (agente externo) → rascunhos + cards conforme área/disciplina/assunto informados. */
export function draftsFromImportFile(file: ImportFile, visibility: Visibility): ReviewState {
  const drafts: Record<string, DraftQuestion> = {}
  const cards = new Map<string, ImportCard>()

  for (const q of file.questoes) {
    const d = draftFromImportQuestion(q, visibility, 'agente_externo')
    drafts[d.id] = d
    upsertCard(cards, q.area, q.disciplina, q.assunto ?? '', d.id)
  }
  return { cards: describeCards([...cards.values()], drafts), drafts, source: 'agente_externo', fileName: file.origem?.arquivo ?? undefined, payload: file }
}

/**
 * Resultado do job no servidor (GET /api/imports/:id em `revisao`) → rascunhos + cards da revisão.
 * Mantém os cards e descrições da IA, as sinalizações do pipeline ("Processado sem IA — revise", visão…)
 * e manda para "Revisar categoria" qualquer questão que nenhum card tenha citado.
 */
export function draftsFromServerJob(
  view: { cards?: ServerCard[]; drafts?: Record<string, ServerDraft>; guide?: DocumentGuide; warnings?: string[] },
  visibility: Visibility,
  fileName?: string,
): ReviewState {
  const drafts: Record<string, DraftQuestion> = {}
  const idMap = new Map<string, string>()
  for (const [serverId, q] of Object.entries(view.drafts ?? {})) {
    const imageFlags = q.descricao_imagem?.includes('imagem não transcrita') ? ['Imagem não transcrita — confira no PDF'] : []
    const d = draftFromImportQuestion(q, visibility, 'pdf_ia', [...(q.flags ?? []), ...imageFlags])
    drafts[d.id] = d
    idMap.set(serverId, d.id)
  }
  const placed = new Set<string>()
  const cards: ImportCard[] = (view.cards ?? [])
    .map((c) => {
      const questionIds = c.questionIds.map((id) => idMap.get(id)).filter((id): id is string => !!id && !placed.has(id))
      for (const id of questionIds) placed.add(id)
      return { id: uid('card'), area: c.area, discipline: c.disciplina, topic: c.assunto, description: c.descricao, questionIds }
    })
    .filter((c) => c.questionIds.length)
  const orphans = Object.keys(drafts).filter((id) => !placed.has(id))
  if (orphans.length) cards.push({ id: uid('card'), area: 'Sem área', discipline: 'Sem disciplina', topic: 'Revisar categoria', description: '', questionIds: orphans })
  const warnings = summarizeWarnings(view.warnings)
  const notes = view.guide || warnings.length ? { guide: view.guide, warnings } : undefined
  return { cards: describeCards(cards, drafts), drafts, source: 'pdf_ia', fileName, ...(notes ? { notes } : {}) }
}

/** Resumo automático do card (no produto: gerado pela IA na etapa de categorização). */
function describeCards(cards: ImportCard[], drafts: Record<string, DraftQuestion>): ImportCard[] {
  return cards.map((c) => {
    const perguntas = c.questionIds.reduce((a, id) => a + (drafts[id]?.items.length ?? 0), 0)
    const comAlternativas = c.questionIds.reduce((a, id) => a + (drafts[id]?.items.filter((i) => i.alternatives?.length).length ?? 0), 0)
    return {
      ...c,
      description: c.description || `${c.questionIds.length} questões · ${perguntas} perguntas · ${comAlternativas} com alternativas. Resumo gerado automaticamente — edite se quiser.`,
    }
  })
}

export function emptyDraft(visibility: Visibility): DraftQuestion {
  return {
    id: uid('dq'),
    stem: '',
    items: [emptyItem()],
    difficulty: 'media',
    visibility,
    origin: 'manual',
    flags: [],
  }
}
