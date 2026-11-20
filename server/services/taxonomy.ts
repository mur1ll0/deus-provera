import { eq } from 'drizzle-orm'
import { db, schema } from '../db/client'

/** Taxonomia em texto compacto para o prompt de classificação ("Medicina > Ginecologia: Prolapso genital, …"). */
export async function loadTaxonomyForPrompt(_userId: string): Promise<string> {
  const rows = await db()
    .select({ area: schema.area.name, discipline: schema.discipline.name })
    .from(schema.discipline)
    .innerJoin(schema.area, eq(schema.area.id, schema.discipline.areaId))
    .limit(400)
  if (!rows.length) return '(vazia — crie as categorias necessárias)'
  return rows.map((r) => `${r.area} > ${r.discipline}`).join('\n')
}

export const slugify = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
