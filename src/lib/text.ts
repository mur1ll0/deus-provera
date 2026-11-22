/** Minúsculas e sem acentos: busca e agrupamento ("Cálculo" = "calculo"). */
export const foldText = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()

/** Ordena opções pelo nome, em pt-BR, sem diferenciar acentos/maiúsculas. */
export const sortByName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
