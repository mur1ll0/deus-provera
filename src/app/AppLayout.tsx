import clsx from 'clsx'
import { FileUp, LayoutDashboard, Library, LogOut, RotateCcw, Timer, Trophy } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Logo } from '@/components/Logo'
import { Avatar } from '@/components/ui'
import { useStore } from '@/mocks/store'
import { initials, useAuth } from './auth-context'

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/simulados', label: 'Simulados', icon: Timer },
  { to: '/questoes', label: 'Banco de questões', short: 'Questões', icon: Library },
  { to: '/importar', label: 'Importar questões', short: 'Importar', icon: FileUp },
  { to: '/ranking', label: 'Ranking', icon: Trophy },
]

export function AppLayout() {
  // Sessão garantida pelo RequireAuth (router.tsx).
  const { user, profile, mode, signOut } = useAuth()
  const { resetDemo } = useStore()
  const navigate = useNavigate()
  const name = profile?.displayName || user?.name || ''
  const subtitle = [profile?.institution, profile?.course].filter(Boolean).join(' · ') || user?.email
  const logout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-white/70 px-4 py-5 backdrop-blur lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-8 space-y-1" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors',
                  isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-muted hover:bg-brand-50 hover:text-brand-700',
                )
              }
            >
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <button onClick={resetDemo} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-muted hover:bg-gold-50 hover:text-gold-600">
            <RotateCcw size={14} /> Restaurar dados de demonstração{mode === 'real' && ' (simulados)'}
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3">
            <Avatar seed={initials(name)} src={user?.image} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{name}</p>
              <p className="truncate text-[11px] text-muted">{subtitle}</p>
            </div>
            <button onClick={() => void logout()} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label="Sair" title="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Topbar (mobile) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button onClick={() => void logout()} className="rounded-lg p-2 text-muted" aria-label="Sair" title="Sair">
          <LogOut size={18} />
        </button>
      </header>

      <main className="min-w-0 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
        <Outlet />
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Principal">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              clsx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-bold', isActive ? 'text-brand-600' : 'text-muted')
            }
          >
            <n.icon size={20} />
            {n.short ?? n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
