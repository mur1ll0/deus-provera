/**
 * Marcador curto da pergunta para o círculo numerado do simulado.
 * O rótulo vem do material importado e pode ser longo ("Parte 2", "Paciente 1", "Item b)"):
 * no círculo só cabe o identificador final ("2", "1", "b"). Sem rótulo usável → posição (1, 2, 3…).
 */
/**
 * Rótulo da pergunta no texto corrido: "a)", "1)" (rótulo curto ganha parêntese); "Parte 2", "Paciente 1"
 * ficam como estão (antes saía "Parte 2)"). Sem rótulo → posição ("1)") ou "Resposta".
 */
export function itemLabelText(label: string | null | undefined, index?: number): string {
  const l = label?.trim()
  if (l) return l.length <= 3 && !/[).:]$/.test(l) ? `${l})` : l
  return index != null ? `${index + 1})` : 'Resposta'
}

export function itemMarker(label: string | null | undefined, index: number): string {
  const clean = label?.trim().replace(/[).:\-–—\s]+$/, '').replace(/^[(]+/, '') ?? ''
  if (clean && clean.length <= 3) return clean
  const last = clean.split(/[\s.:\-–—()]+/).filter(Boolean).pop()
  return last && last.length <= 3 ? last : String(index + 1)
}
