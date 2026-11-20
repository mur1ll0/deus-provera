import { useMutation } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/app/auth-context'
import { Button } from '@/components/ui'

/**
 * Aviso único do primeiro acesso (spec 001 › US1 cenário 3, FR-006/FR-013; T020):
 * explica o ranking e onde desativar. "Entendi" grava `onboarded_at` (e `privacy_ack_at`).
 */
export function OnboardingNotice() {
  const { profile, user, updateProfile } = useAuth()
  const ack = useMutation({ mutationFn: () => updateProfile({ onboarded: true }) })
  if (!profile || profile.onboardedAt) return null
  const name = profile.displayName || user?.name

  return (
    <section aria-labelledby="onboarding-title" className="mb-6 rounded-2xl border border-gold-300 bg-gold-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <div className="rounded-xl bg-white p-2 text-gold-600">
          <ShieldCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="onboarding-title" className="font-display text-sm font-bold">
            Bem-vindo! Você aparece no ranking da turma como “{name}”.
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Seus pontos nos simulados entram no ranking. Se preferir, troque o nome de exibição ou desligue “Aparecer no ranking” no seu perfil. Guardamos só
            nome, e-mail e foto do Google — nada do Gmail ou do Drive.
          </p>
          {ack.error && (
            <p role="alert" className="mt-2 text-sm text-rose-600">
              {ack.error.message}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => ack.mutate()} disabled={ack.isPending}>
              {ack.isPending ? 'Salvando…' : 'Entendi'}
            </Button>
            <Link to="/perfil" onClick={() => ack.mutate()}>
              <Button size="sm" variant="secondary" tabIndex={-1}>
                Ajustar meu perfil
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
