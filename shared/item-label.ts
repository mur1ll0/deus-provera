/**
 * Marcador curto da pergunta para o círculo numerado do simulado.
 * O rótulo vem do material importado e pode ser longo ("Parte 2", "Paciente 1", "Item b)"):
 * no círculo só cabe o identificador final ("2", "1", "b"). Sem rótulo usável → posição (1, 2, 3…).
 */
export function itemMarker(label: string | null | undefined, index: number): string {
  const clean = label?.trim().replace(/[).:\-–—\s]+$/, '').replace(/^[(]+/, '') ?? ''
  if (clean && clean.length <= 3) return clean
  const last = clean.split(/[\s.:\-–—()]+/).filter(Boolean).pop()
  return last && last.length <= 3 ? last : String(index + 1)
}
