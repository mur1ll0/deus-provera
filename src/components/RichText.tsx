import clsx from 'clsx'
import { useMemo } from 'react'
import { parseRichText, type RichCell } from '@shared/rich-text'

/**
 * Mostra enunciado/pergunta/resposta preservando quebras de linha e desenhando as tabelas
 * Markdown do texto (POP-Q, tabelas de exames, dados de gráficos). Só texto puro: os elementos
 * são montados aqui, nunca via HTML (ver shared/rich-text.ts).
 */
export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  const blocks = useMemo(() => parseRichText(text), [text])
  return (
    <div className={clsx('space-y-2', className)}>
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <p key={i} className="whitespace-pre-line">
            {b.text}
          </p>
        ) : (
          <div key={i} className="max-w-full overflow-x-auto">
            <table className="border-collapse text-center text-sm tabular-nums">
              {b.header && (
                <thead>
                  <tr>
                    {b.header.map((c, j) => (
                      <th key={j} scope="col" className="border border-line bg-brand-50 px-3 py-1.5 font-semibold">
                        {c.text}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <Cell key={j} cell={c} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  )
}

function Cell({ cell }: { cell: RichCell }) {
  return <td className={clsx('border border-line px-3 py-1.5', cell.strong ? 'bg-brand-50/70 font-semibold' : 'bg-white/60')}>{cell.text}</td>
}
