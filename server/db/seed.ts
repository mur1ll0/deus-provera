/**
 * Seed idempotente da taxonomia global (áreas e disciplinas comuns). `npm run db:seed`
 * Rodar de novo só acrescenta o que faltar (conflito por slug é ignorado).
 */
import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file)
}

export const TAXONOMY_SEED: Record<string, string[]> = {
  Medicina: [
    'Anatomia', 'Fisiologia', 'Bioquímica', 'Histologia e Embriologia', 'Genética', 'Farmacologia', 'Patologia',
    'Microbiologia', 'Imunologia', 'Parasitologia', 'Semiologia', 'Clínica Médica', 'Cardiologia', 'Pneumologia',
    'Gastroenterologia', 'Nefrologia', 'Endocrinologia', 'Neurologia', 'Infectologia', 'Hematologia', 'Reumatologia',
    'Dermatologia', 'Psiquiatria', 'Pediatria', 'Ginecologia', 'Obstetrícia', 'Cirurgia Geral', 'Ortopedia',
    'Urologia', 'Oftalmologia', 'Otorrinolaringologia', 'Oncologia', 'Geriatria', 'Medicina de Emergência',
    'Medicina de Família e Comunidade', 'Saúde Coletiva', 'Medicina Legal e Ética',
  ],
  Enfermagem: ['Fundamentos de Enfermagem', 'Saúde do Adulto', 'Saúde da Mulher', 'Saúde da Criança', 'Saúde Coletiva', 'Farmacologia', 'Urgência e Emergência'],
  Odontologia: ['Anatomia Dental', 'Periodontia', 'Endodontia', 'Dentística', 'Prótese', 'Cirurgia Bucomaxilofacial', 'Odontopediatria'],
  Fisioterapia: ['Cinesiologia', 'Fisioterapia Neurológica', 'Fisioterapia Ortopédica', 'Fisioterapia Respiratória'],
  Psicologia: ['Psicologia do Desenvolvimento', 'Psicopatologia', 'Psicologia Social', 'Teorias da Personalidade', 'Neuropsicologia'],
  Direito: ['Direito Constitucional', 'Direito Civil', 'Direito Penal', 'Direito Administrativo', 'Processo Civil', 'Processo Penal'],
  Matemática: ['Cálculo', 'Álgebra Linear', 'Geometria Analítica', 'Estatística', 'Equações Diferenciais'],
  Engenharia: ['Física', 'Mecânica', 'Resistência dos Materiais', 'Circuitos Elétricos', 'Programação'],
}

async function main() {
  const { db, schema } = await import('./client')
  const { slugify } = await import('../services/taxonomy')
  let areas = 0
  let disciplines = 0
  for (const [areaName, discNames] of Object.entries(TAXONOMY_SEED)) {
    const slug = slugify(areaName)
    const inserted = await db().insert(schema.area).values({ name: areaName, slug }).onConflictDoNothing().returning({ id: schema.area.id })
    areas += inserted.length
    const [a] = await db().select({ id: schema.area.id }).from(schema.area).where(eq(schema.area.slug, slug))
    const rows = discNames.map((name) => ({ areaId: a.id, name, slug: slugify(name) }))
    const d = await db().insert(schema.discipline).values(rows).onConflictDoNothing().returning({ id: schema.discipline.id })
    disciplines += d.length
  }
  console.log(`Seed concluído: ${areas} áreas e ${disciplines} disciplinas novas.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
