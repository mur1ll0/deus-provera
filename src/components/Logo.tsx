import { Sprout } from 'lucide-react'

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-600 text-gold-400 shadow-sm">
        <Sprout size={22} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span className="leading-tight text-ink">
          <span className="block font-display text-[15px] font-extrabold">Deus Proverá</span>
          <span className="block text-[11px] text-muted">Estude com fé</span>
        </span>
      )}
    </div>
  )
}
