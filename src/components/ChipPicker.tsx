import clsx from 'clsx'
import { Search, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { foldText } from '@/lib/text'

/** Opção de um ChipPicker; `ids` agrupa linhas de mesmo nome (ex.: a mesma disciplina em duas áreas). */
export interface Option {
  key: string
  name: string
  ids: string[]
}

/** A partir de quantas opções o picker mostra a busca. */
const SEARCH_FROM = 8

/** Chips com busca e área rolável: listas longas (dezenas de disciplinas) não ocupam a tela. */
export function ChipPicker({
  label,
  options,
  isActive,
  onToggle,
  leading,
  empty = 'Nada por aqui.',
}: {
  label: string
  options: Option[]
  isActive: (o: Option) => boolean
  onToggle: (o: Option) => void
  leading?: ReactNode
  empty?: string
}) {
  const [query, setQuery] = useState('')
  const q = foldText(query)
  const visible = q ? options.filter((o) => foldText(o.name).includes(q)) : options
  return (
    <div>
      {options.length >= SEARCH_FROM && (
        <label className="relative mb-3 block">
          <span className="sr-only">Buscar {label}</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Buscar ${label}…`}
            className="w-full rounded-xl border border-line bg-white py-2 pr-9 pl-9 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted hover:text-ink">
              <X size={14} />
            </button>
          )}
        </label>
      )}
      <div className="scrollbar-thin -mx-1 max-h-44 overflow-y-auto px-1 py-0.5">
        <div className="flex flex-wrap gap-2">
          {leading}
          {visible.map((o) => (
            <Chip key={o.key} active={isActive(o)} onClick={() => onToggle(o)}>
              {o.name}
            </Chip>
          ))}
        </div>
        {!visible.length && <p className="py-2 text-sm text-muted">{q ? `Nada encontrado para "${query.trim()}".` : empty}</p>}
      </div>
    </div>
  )
}

export function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-bold text-brand-600 hover:underline">
      Limpar
    </button>
  )
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-bold transition',
        active ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink hover:border-brand-300',
      )}
    >
      {children}
    </button>
  )
}
