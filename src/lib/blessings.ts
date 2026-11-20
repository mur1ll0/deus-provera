/**
 * Frases de fé e ânimo do painel (tom do projeto "Deus Proverá").
 * Versículos na redação da Almeida Revista e Corrigida (ARC), com a referência.
 */
export interface Blessing {
  text: string
  ref?: string
}

export const BLESSINGS: Blessing[] = [
  { text: 'Tenha fé em você e bons estudos.' },
  { text: 'Faça a sua parte. O resto, Deus proverá.' },
  { text: 'Tudo posso naquele que me fortalece.', ref: 'Filipenses 4:13' },
  { text: 'Estudos abençoados começam com o primeiro passo.' },
  { text: 'Entrega o teu caminho ao Senhor.', ref: 'Salmos 37:5' },
  { text: 'Cada questão resolvida é um passo de fé.' },
  { text: 'Esforça-te e tem bom ânimo.', ref: 'Josué 1:9' },
  { text: 'Confia ao Senhor as tuas obras.', ref: 'Provérbios 16:3' },
  { text: 'Quem semeia com dedicação colhe com alegria.' },
]

/** A frase do dia: muda uma vez por dia (data local) e é a mesma em todas as visitas desse dia. */
export function blessingOfTheDay(date = new Date()): Blessing {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
  return BLESSINGS[day % BLESSINGS.length]
}
