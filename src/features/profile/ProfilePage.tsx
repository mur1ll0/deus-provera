import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Check, Trash2, Trophy } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ACCOUNT_DELETE_CONFIRM, PROFILE_LIMITS, profilePatch } from '@shared/schemas/profile'
import { initials, useAuth, type AuthProfile } from '@/app/auth-context'
import { Avatar, Button, Card, Field, inputClass, PageHeader } from '@/components/ui'

/** Perfil e privacidade (spec 001 › US3) + zona de perigo (US4). Rota /perfil. */
export function ProfilePage() {
  const { user, profile } = useAuth()
  if (!user || !profile) return null
  // O formulário guarda o rascunho; após salvar, o rascunho = perfil salvo (dirty volta a false).
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Conta" title="Seu perfil" description="Como você aparece para a turma e o que fazer com os seus dados." />
      <ProfileForm key={user.id} profile={profile} />
      <DangerZone />
    </div>
  )
}

function ProfileForm({ profile }: { profile: AuthProfile }) {
  const { user, updateProfile } = useAuth()
  const [displayName, setDisplayName] = useState(profile.displayName ?? user?.name ?? '')
  const [institution, setInstitution] = useState(profile.institution ?? '')
  const [course, setCourse] = useState(profile.course ?? '')
  const [showInRanking, setShowInRanking] = useState(profile.showInRanking)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => setSaved(true),
  })

  const draft = { displayName, institution, course, showInRanking }
  const check = profilePatch.safeParse(draft)
  const error = save.error?.message ?? (!check.success ? check.error.issues[0]?.message : null)
  const dirty =
    displayName !== (profile.displayName ?? user?.name ?? '') ||
    institution !== (profile.institution ?? '') ||
    course !== (profile.course ?? '') ||
    showInRanking !== profile.showInRanking

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!check.success || !dirty) return
    setSaved(false)
    save.mutate(draft)
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex items-center gap-4">
          <Avatar seed={initials(displayName || user?.name || '')} src={user?.image} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display font-bold">{user?.name}</p>
            <p className="truncate text-sm text-muted">{user?.email}</p>
            <p className="mt-0.5 text-xs text-muted">Conta Google — nome e foto vêm do Google.</p>
          </div>
        </div>

        <Field label="Nome de exibição" hint={`Aparece no ranking e no painel (${PROFILE_LIMITS.displayNameMin}–${PROFILE_LIMITS.displayName} caracteres).`}>
          <input className={inputClass} value={displayName} onChange={(e) => (setDisplayName(e.target.value), setSaved(false))} maxLength={PROFILE_LIMITS.displayName * 2} autoComplete="nickname" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instituição (opcional)">
            <input className={inputClass} value={institution} onChange={(e) => (setInstitution(e.target.value), setSaved(false))} maxLength={PROFILE_LIMITS.institution * 2} placeholder="Ex.: UFPR" autoComplete="organization" />
          </Field>
          <Field label="Curso (opcional)">
            <input className={inputClass} value={course} onChange={(e) => (setCourse(e.target.value), setSaved(false))} maxLength={PROFILE_LIMITS.course * 2} placeholder="Ex.: Medicina — 5º período" />
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4">
          <input type="checkbox" className="peer sr-only" checked={showInRanking} onChange={(e) => (setShowInRanking(e.target.checked), setSaved(false))} />
          <span
            aria-hidden
            className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Trophy size={15} className="text-gold-600" /> Aparecer no ranking da turma
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              Desligado, os outros estudantes não veem você no ranking. Seus pontos continuam contando e você ainda vê a sua posição.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto min-h-5 text-sm" aria-live="polite">
            {error && dirty ? (
              <span role="alert" className="text-rose-600">
                {error}
              </span>
            ) : saved ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check size={15} /> Perfil salvo.
              </span>
            ) : null}
          </p>
          <Button type="submit" disabled={!dirty || !check.success || save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function DangerZone() {
  const { deleteAccount } = useAuth()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const remove = useMutation({
    mutationFn: () => deleteAccount(confirm),
    onSuccess: () => navigate('/login', { replace: true }),
  })
  const ready = confirm === ACCOUNT_DELETE_CONFIRM

  return (
    <Card className="border-rose-200 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-rose-700">
        <AlertTriangle size={18} /> Zona de perigo
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Excluir a conta apaga para sempre seu perfil, suas questões, importações, simulados e pontos. Questões públicas que outros estudantes já
        responderam ficam anônimas e sem conteúdo, só para preservar a pontuação deles. Não dá para desfazer.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !remove.isPending) remove.mutate()
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <Field label={`Digite ${ACCOUNT_DELETE_CONFIRM} para confirmar`}>
            <input className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="delete-error" />
          </Field>
        </div>
        <Button type="submit" variant="danger" disabled={!ready || remove.isPending}>
          <Trash2 size={16} /> {remove.isPending ? 'Excluindo…' : 'Excluir minha conta'}
        </Button>
      </form>
      <p id="delete-error" className="mt-2 min-h-5 text-sm text-rose-600" role="alert" aria-live="assertive">
        {remove.error?.message}
      </p>
    </Card>
  )
}
