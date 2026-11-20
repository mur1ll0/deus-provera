import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/ui'

export function NotFound() {
  return (
    <EmptyState icon={<Compass />} title="Página não encontrada">
      <Link to="/" className="font-bold text-brand-600">
        Voltar ao painel
      </Link>
    </EmptyState>
  )
}
