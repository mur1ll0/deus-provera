import type { QuestionItem, Visibility } from '@shared/domain'
import { inspectText } from '@shared/guardrails'
import type { ImportFile } from '@shared/schemas/import'
import { heuristicKeyPoints, type SegmentedQuestion } from '@shared/segmenter'
import { classifyQuestion } from '@/mocks/ai'
import { emptyItem, uid, type DraftQuestion, type ImportCard } from '@/mocks/model'

export interface ReviewState {
  cards: ImportCard[]
  drafts: Record<string, DraftQuestion>
  source: 'pdf_ia' | 'agente_externo' | 'manual'
  fileName?: string
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
    const stem = guard(seg.stem, flags) ?? seg.stem
    const qItems: QuestionItem[] = seg.items.map((it) => {
      const answer = guard(it.answer, flags)
      return {
        id: uid('it'),
        label: it.label,
        prompt: guard(it.prompt, flags) ?? it.prompt,
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

/** JSON v2 (agente externo) → rascunhos + cards conforme área/disciplina/assunto informados. */
export function draftsFromImportFile(file: ImportFile, visibility: Visibility): ReviewState {
  const drafts: Record<string, DraftQuestion> = {}
  const cards = new Map<string, ImportCard>()

  for (const q of file.questoes) {
    const flags = new Set<string>()
    const id = uid('dq')
    drafts[id] = {
      id,
      sourceLabel: q.rotulo ?? undefined,
      stem: guard(q.enunciado, flags) ?? q.enunciado,
      items: q.perguntas.map((p) => ({
        id: uid('it'),
        label: p.rotulo ?? undefined,
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
      origin: 'agente_externo',
      hasImage: q.tem_imagem ?? undefined,
      imageDescription: guard(q.descricao_imagem, flags),
      flags: [...flags],
    }
    upsertCard(cards, q.area, q.disciplina, q.assunto ?? '', id)
  }
  return { cards: describeCards([...cards.values()], drafts), drafts, source: 'agente_externo', fileName: file.origem?.arquivo ?? undefined }
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
