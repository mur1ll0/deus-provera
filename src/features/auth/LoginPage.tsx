import { BrainCircuit, FileUp, ShieldCheck, Timer, Trophy } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { safeRedirect, useAuth } from '@/app/auth-context'
import { FullScreen } from '@/app/RequireAuth'
import { Logo } from '@/components/Logo'

const FEATURES = [
  { icon: FileUp, title: 'Seus PDFs viram questões', text: 'Envie suas listas respondidas: a IA separa, categoriza e cria alternativas.' },
  { icon: Timer, title: 'Simulados do seu jeito', text: 'Modo prova cronometrado ou treino com respostas e dicas na hora.' },
  { icon: BrainCircuit, title: 'IA que explica', text: 'Entenda por que cada alternativa está certa ou errada.' },
  { icon: Trophy, title: 'Ranking da turma', text: 'Pontue resolvendo simulados e acompanhe sua evolução.' },
]

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [pending, setPending] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const from = safeRedirect(params.get('redirect') ?? (location.state as { from?: string } | null)?.from)
  // Better Auth devolve ?error=… no errorCallbackURL (ex.: access_denied quando o usuário cancela no Google).
  const oauthError = params.get('error')
  const errorMessage =
    startError ?? (oauthError ? (oauthError === 'access_denied' ? 'Login cancelado. Tente novamente.' : 'Não foi possível entrar com o Google. Tente novamente.') : null)

  if (auth.status === 'loading') return <FullScreen>Carregando…</FullScreen>
  if (auth.user) return <Navigate to={from} replace />

  async function enter() {
    setPending(true)
    setStartError(null)
    try {
      await auth.signIn(from)
      // Real: o navegador vai para o Google. Protótipo: login simulado imediato.
      if (auth.mode === 'prototipo') navigate(from, { replace: true })
    } catch (err) {
      setStartError((err as Error).message)
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="relative overflow-hidden bg-brand-700 px-6 py-10 text-white sm:px-12 lg:py-16">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 size-80 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="relative">
          <div className="inline-flex rounded-2xl bg-white p-2 pr-4">
            <Logo />
          </div>
          <h1 className="mt-10 max-w-xl text-4xl font-extrabold leading-tight sm:text-5xl">
            Estude como a prova cobra. <span className="text-gold-400">O resto, Deus proverá.</span>
          </h1>
          <p className="mt-4 max-w-lg text-brand-100">
            Simulados configuráveis, tempo por questão, correção comentada e um banco de questões alimentado por você e pela sua turma.
          </p>
          <ul className="mt-10 grid max-w-2xl gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-2xl bg-white/10 p-4 backdrop-blur">
                <f.icon className="mb-2 text-gold-400" size={22} />
                <p className="font-display font-bold">{f.title}</p>
                <p className="mt-1 text-sm text-brand-100">{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="card w-full max-w-sm p-8 text-center">
          <h2 className="text-2xl font-extrabold">Entrar</h2>
          <p className="mt-2 text-sm text-muted">Use sua conta Google para salvar estatísticas, questões e simulados.</p>
          {errorMessage && (
            <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">
              {errorMessage}
            </p>
          )}
          {auth.status === 'error' && (
            <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">
              {auth.error}
            </p>
          )}
          <button
            onClick={() => void enter()}
            disabled={pending || auth.status === 'error'}
            aria-busy={pending}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-white px-4 py-3 font-display text-sm font-bold shadow-sm transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-wait disabled:opacity-60"
          >
            <GoogleIcon /> {pending ? 'Abrindo o Google…' : 'Entrar com Google'}
          </button>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} /> Só usamos nome, e-mail e foto do seu perfil.
          </p>
          {auth.mode === 'prototipo' && (
            <p className="mt-6 rounded-xl bg-gold-50 p-3 text-xs text-gold-600">
              <b>Protótipo sem API:</b> o login é simulado e os dados ficam apenas no seu navegador. Para o login real, rode <code>npm run dev:api</code>.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
