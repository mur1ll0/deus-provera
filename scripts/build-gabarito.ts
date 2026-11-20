/**
 * Junta as partes extraídas (samples/private/extracao/*.md) em:
 *   samples/private/gabarito-unidade-ii.md   / .json (formato de importação v2)
 *   samples/private/gabarito-iii-unidade.md  / .json
 * e valida o JSON com o mesmo validador do app (shared/schemas/import.ts).
 *
 * Uso: npm run gabarito:build
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseImportText } from '../shared/schemas/import'
import { goldToImportFile, parseGabarito } from './gabarito'

const DIR = 'samples/private/extracao'
const DOCS = [
  { prefix: 'u2', pdf: 'Unidade II.pdf', out: 'samples/private/gabarito-unidade-ii' },
  { prefix: 'u3', pdf: 'III UNIDADE.pdf', out: 'samples/private/gabarito-iii-unidade' },
]

for (const d of DOCS) {
  const parts = readdirSync(DIR)
    .filter((f) => f.startsWith(`${d.prefix}-`) && f.endsWith('.md'))
    .sort()
  const body = parts.map((f) => readFileSync(join(DIR, f), 'utf8').trim()).join('\n\n')
  const gold = parseGabarito(body, d.pdf)
  const items = gold.reduce((a, q) => a + q.items.length, 0)
  const answered = gold.reduce((a, q) => a + q.items.filter((i) => i.expectedAnswer || i.alternatives.some((x) => x.correct)).length, 0)
  const withAlts = gold.reduce((a, q) => a + q.items.filter((i) => i.alternatives.length >= 2).length, 0)
  const withImage = gold.filter((q) => q.image).length

  const header = `# Gabarito de referência — ${d.pdf}

> Extração manual assistida (agentes de IA lendo o texto e as imagens de cada página), usada como
> **referência** para avaliar o importador (\`npm run eval:import\`). Conteúdo de terceiros: **não versionar**.
>
> ${gold.length} questões · ${items} perguntas · ${answered} com resposta · ${withAlts} com alternativas · ${withImage} dependem de imagem.
> Formato: samples/private/extracao/INSTRUCOES.md · Gerado em ${new Date().toISOString().slice(0, 10)}.
`
  writeFileSync(`${d.out}.md`, `${header}\n${body}\n`)

  const { file, skippedItems, skippedQuestions } = goldToImportFile(gold, d.pdf)
  const json = JSON.stringify(file, null, 2)
  writeFileSync(`${d.out}.json`, json)
  const check = parseImportText(json)
  console.log(
    `${d.pdf}: ${gold.length} questões, ${items} perguntas (${answered} com resposta, ${withAlts} com alternativas, ${withImage} c/ imagem) → ` +
      `JSON v2 com ${file.questoes.length} questões (${skippedItems} perguntas e ${skippedQuestions} questões sem resposta omitidas) · validação: ${check.ok ? 'OK' : `${check.errors.length} erro(s)`}`,
  )
  for (const e of check.errors.slice(0, 15)) console.log(`   ✗ ${e.path}: ${e.message}`)
}
