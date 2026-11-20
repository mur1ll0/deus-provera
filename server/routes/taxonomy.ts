import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, schema } from '../db/client'
import { requireUser, type AppEnv } from '../middleware'

/** Taxonomia global: Área › Disciplina (assuntos ficam nas questões/cards). */
export const taxonomyRoutes = new Hono<AppEnv>().use(requireUser).get('/', async (c) => {
  const [areas, disciplines] = await Promise.all([
    db().select({ id: schema.area.id, name: schema.area.name }).from(schema.area).orderBy(asc(schema.area.name)),
    db().select({ id: schema.discipline.id, areaId: schema.discipline.areaId, name: schema.discipline.name }).from(schema.discipline).orderBy(asc(schema.discipline.name)),
  ])
  return c.json({ areas, disciplines })
})

export type TaxonomyRoutes = typeof taxonomyRoutes
