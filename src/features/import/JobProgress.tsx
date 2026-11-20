import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import type { JobProgress } from './importJob'
import type { ImportJobState } from './useImportJob'

/** Progresso da importação real (POST /api/imports → visão → /run em loop). Spec 002 T031/T060. */

interface Step {
  id: string
  label: string
  detail: (p: JobProgress, s: ImportJobState) => string
}

const VISION_STEPS: Step[] = [
  { id: 'recortando', label: 'Recortando as imagens no navegador', detail: (p) => (p.crops ? `${p.crops.done} de ${p.crops.total} recortes · o PDF não sai do seu computador` : 'Quadros, fotos e prints das páginas') },
  {
    id: 'imagens',
    label: 'Transcrevendo as imagens (IA de visão)',
    detail: (p, s) => {
      const b = p.batches
      const img = s.upload ?? (p.images ? { ok: p.images.ok, failed: p.images.failed } : null)
      if (s.upload) return `${s.upload.ok} transcrita(s)${s.upload.failed ? ` · ${s.upload.failed} sem transcrição (ficam como “[Imagem p. N]”)` : ''}`
      return b ? `Lote ${Math.min(b.done + 1, b.total)} de ${b.total} (3 imagens por vez, ~30–60 s cada)${img?.ok ? ` · ${img.ok} prontas` : ''}` : 'Modelo gratuito com fallback'
    },
  },
]

const SERVER_STEPS: Step[] = [
  { id: 'guard', label: 'Guardrail de segurança', detail: () => 'Remove tentativas de injeção do texto' },
  { id: 'segment', label: 'Segmentação', detail: (p) => (p.blocks ? `${p.blocks} questões encontradas` : 'Separa enunciados e perguntas') },
  { id: 'structure', label: 'Estruturação com IA', detail: (p) => (p.pendingBatches ? `Faltam ${p.pendingBatches} lote(s) de até 3 questões` : 'Enunciado, perguntas, respostas e pontos-chave') },
  { id: 'classify', label: 'Categorização', detail: () => 'Área › Disciplina › Assunto' },
  { id: 'validate', label: 'Validação final', detail: () => 'Contrato e sinalizações para a revisão' },
]

/** Posição do nó do servidor na lista (o cursor é o nó em execução / o próximo). */
function serverIndex(node: string | undefined): number {
  if (!node || node === 'guard' || node === 'vision') return 0
  if (node === 'segment') return 1
  if (node === 'structure') return 2
  if (node === 'classify') return 3
  if (node === 'plan-distractors' || node === 'distractors' || node === 'validate') return 4
  return 5 // __end__
}

export function JobProgressCard({ state, withVision, onResume, onBack, onUseAgent }: { state: ImportJobState; withVision: boolean; onResume: () => void; onBack: () => void; onUseAgent: () => void }) {
  const p: JobProgress = state.progress ?? { phase: 'criando' }
  const steps = [...(withVision ? VISION_STEPS : []), ...SERVER_STEPS]
  const visionOffset = withVision ? VISION_STEPS.length : 0
  const current =
    p.phase === 'criando' ? -1 : p.phase === 'recortando' ? 0 : p.phase === 'imagens' ? 1 : p.phase === 'revisao' ? steps.length : visionOffset + serverIndex(p.node)
  const err = state.status === 'error' ? state.error : null

  return (
    <Card className="mx-auto max-w-xl p-6">
      <h2 className="text-lg font-bold">{err ? 'Importação pausada' : `Processando ${state.fileName ?? 'PDF'}…`}</h2>
      <p className="mt-1 text-sm text-muted" aria-live="polite">
        {err
          ? err.message
          : p.phase === 'criando'
            ? 'Enviando o texto extraído…'
            : 'Modelos gratuitos com fallback automático. Pode levar alguns minutos — o progresso fica salvo se você sair.'}
      </p>

      <ol className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-3">
            <span className="mt-0.5">
              {i < current ? (
                <CheckCircle2 size={20} className="text-emerald-600" />
              ) : i === current && !err ? (
                <Loader2 size={20} className="animate-spin text-brand-600" />
              ) : i === current && err ? (
                <AlertTriangle size={20} className="text-gold-600" />
              ) : (
                <span className="block size-5 rounded-full border-2 border-line" />
              )}
            </span>
            <div className="min-w-0">
              <p className={clsx('text-sm font-bold', i > current && 'text-muted')}>{s.label}</p>
              <p className="text-xs text-muted">{i <= current ? s.detail(p, state) : s.detail({ phase: p.phase }, { ...state, upload: null })}</p>
            </div>
          </li>
        ))}
      </ol>

      {err && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {state.jobId && <Button onClick={onResume}>{err.kind === 'cancelado' ? 'Continuar acompanhando' : 'Tentar continuar'}</Button>}
          {err.kind === 'cota' && (
            <Button variant="secondary" onClick={onUseAgent}>
              Usar meu agente de IA
            </Button>
          )}
          <Button variant="ghost" onClick={onBack}>
            Voltar
          </Button>
          {err.kind === 'cota' && <p className="w-full text-xs text-muted">O progresso está salvo: amanhã a cota renova e você continua de onde parou. Enquanto isso, o agente externo não usa a cota do sistema.</p>}
        </div>
      )}
    </Card>
  )
}
