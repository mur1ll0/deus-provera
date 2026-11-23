/**
 * AVALIAÇÃO DA LIGAÇÃO QUESTÕES × GABARITO (spec 002 US6, docs/10 §10).
 *
 *   npm run eval:link -- questoes.pdf gabarito.pdf     → PDFs separados (o papel de cada um é DETECTADO)
 *   npm run eval:link -- --single material.pdf         → PDF único (gabarito no fim ou resposta junto da questão)
 *
 * Sem IA e sem banco: extrai o texto com pdf.js (como o navegador), detecta o papel de cada arquivo e roda o
 * MESMO `segmentImport` do nó `segment`. Depois confere cada resposta ligada de forma INDEPENDENTE do parser,
 * no texto cru do gabarito:
 *   - fiel: o texto da resposta está, literalmente, no gabarito;
 *   - no bloco certo: dentro do trecho entre o cabeçalho da MESMA questão ("Estação 1.3", "QUESTÃO 7"…) e o
 *     cabeçalho seguinte (recorte feito aqui com regex simples, não com o segmentador);
 *   - rótulo certo: logo antes da resposta está o rótulo do item ("b)", "Parte 3");
 *   - cobertura: quanto do texto dos blocos do gabarito foi parar em alguma resposta (nada perdido).
 * Saída: resumo no console + samples/private/eval/relatorio-ligacao-*.md (privado: conteúdo de terceiros).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { detectDocumentRole, linkSummary, questionKey, segmentImport, type ImportDocument } from '../shared/answer-key'
import { openPdfWithImages } from './pdf-images-node'

const args = process.argv.slice(2)
const single = args.includes('--single')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) {
  console.error('Uso: npm run eval:link -- questoes.pdf gabarito.pdf   |   npm run eval:link -- --single material.pdf')
  process.exit(1)
}

async function load(path: string) {
  const pdf = await openPdfWithImages(path)
  const pages = pdf.pages.map((p) => ({ page: p.page, text: p.plainText }))
  await pdf.destroy()
  return pages
}

const norm = (s: string) => s.replace(/\[\[página \d+\]\]/g, '').replace(/\s+/g, '').normalize('NFC')
/** Cabeçalhos de questão no texto cru — regex própria, independente do segmentador. */
const HEAD = /^[ \t]*(?:QUEST[ÃA]O|Quest[ãa]o|ESTA[ÇC][ÃA]O|Esta[çc][ãa]o)\s*((?:\d{1,3}[A-Z]?|[A-Z])(?:\.\d{1,3})?)\b/gm

/** Trechos do gabarito por chave (k-ésima ocorrência do mesmo número = k-ésimo trecho). */
function rawBlocks(text: string): Map<string, string[]> {
  const marks = [...text.matchAll(HEAD)].map((m) => ({ key: questionKey(`Questão ${m[1]}`) ?? m[1], index: m.index ?? 0 }))
  const out = new Map<string, string[]>()
  marks.forEach((m, i) => out.set(m.key, [...(out.get(m.key) ?? []), text.slice(m.index, marks[i + 1]?.index ?? text.length)]))
  return out
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—')

async function main() {
  let offset = 0
  let full = ''
  const docs: ImportDocument[] = []
  const roles: string[] = []
  for (const f of files) {
    const pages = await load(f)
    const text = pages.map((p) => `\n[[página ${p.page + offset}]]\n${p.text}`).join('\n')
    const role = single ? { role: 'misto' as const, reason: 'arquivo único' } : detectDocumentRole(text)
    roles.push(`${basename(f)} → ${role.role} (${role.reason})`)
    docs.push({ name: basename(f), role: role.role, firstPage: offset + 1, lastPage: offset + pages.length })
    full += text
    offset += pages.length
  }
  const t0 = performance.now()
  const r = segmentImport(full, docs.length > 1 ? docs : undefined)
  const ms = performance.now() - t0

  // texto cru das respostas: arquivos de gabarito, ou a seção de respostas do PDF único
  const answerText = docs.length > 1 ? docs.filter((d) => d.role === 'respostas').map((d) => full.slice(full.indexOf(`[[página ${d.firstPage}]]`), d.lastPage === offset ? undefined : full.indexOf(`[[página ${d.lastPage + 1}]]`))).join('\n') : r.answerSectionPage ? full.slice(full.indexOf(`[[página ${r.answerSectionPage}]]`)) : ''
  const blocks = rawBlocks(answerText)
  const seen = new Map<string, number>()
  let items = 0
  let answered = 0
  let faithful = 0
  let inBlock = 0
  let labelOk = 0
  let covered = 0
  let blockChars = 0
  const problems: string[] = []
  for (const q of r.questions) {
    const key = questionKey(q.sourceLabel)
    const occ = key ? (seen.get(key) ?? 0) : 0
    if (key) seen.set(key, occ + 1)
    const raw = key ? blocks.get(key)?.[occ] : undefined
    const nb = raw ? norm(raw) : ''
    // corpo do bloco, para a cobertura: sem o cabeçalho (e a 2ª linha de um título quebrado), sem "Fonte:" e sem
    // o título/resumo do tema seguinte ("2 — Tema — Gabarito", quadro de apoio), que não é resposta de ninguém
    let bodyLines = raw ? raw.split('\n').slice(1) : []
    if (bodyLines[0] && /^\p{Ll}/u.test(bodyLines[0].trim()) && !/^[a-h]\)/.test(bodyLines[0].trim())) bodyLines = bodyLines.slice(1)
    const themeAt = bodyLines.findIndex((l) => /^(?:\d{1,2}[A-Z]?|[A-Z]|Extra)\s+[—–]\s/.test(l.trim()))
    if (themeAt >= 0) bodyLines = bodyLines.slice(0, themeAt)
    const body = norm(bodyLines.filter((l) => !/^\s*Fonte\s*:/i.test(l)).join('\n'))
    let cov = 0
    for (const it of q.items) {
      items++
      if (!it.answer) continue
      answered++
      if (!answerText) continue // resposta junto da questão: não há gabarito a conferir
      const a = norm(it.answer)
      const lines = it.answer.split('\n')
      // resposta de etapa juntada ("Parte 3: …" acrescentado): confere cada pedaço
      const pieces = lines.map((l) => norm(l.replace(/^(Parte \d+|[a-h]\)):\s*/, ''))).filter(Boolean)
      if (norm(answerText).includes(a) || pieces.every((p) => norm(answerText).includes(p))) faithful++
      else problems.push(`${q.sourceLabel} ${it.label ?? ''}: resposta não está no gabarito`)
      if (nb && pieces.every((p) => nb.includes(p))) inBlock++
      else problems.push(`${q.sourceLabel} ${it.label ?? ''}: resposta fora do bloco da questão`)
      const at = nb.indexOf(pieces[0] ?? a)
      const before = at >= 0 ? nb.slice(Math.max(0, at - 16), at) : ''
      const lab = it.label?.replace(/\s/g, '')
      // sem esse rótulo no bloco do gabarito (resposta única) não há rótulo a conferir
      if (!lab || !nb.includes(lab.startsWith('Parte') ? lab : `${lab})`) || before.endsWith(`${lab})`) || new RegExp(`${lab}[,:.)\\-–—]?[^)]{0,12}$`).test(before)) labelOk++
      else problems.push(`${q.sourceLabel} ${it.label}: rótulo não precede a resposta`)
      cov += pieces.reduce((s, p) => s + p.length, 0)
    }
    if (body) {
      const labels = (body.match(/(?:[a-h]\)|Partes?\d+(?:e\d+)?[:,.\-–—]?)/g) ?? []).join('').length
      covered += Math.min(cov, body.length - labels)
      blockChars += body.length - labels
    }
  }

  const lines = [
    `# Ligação questões × gabarito — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    ...roles.map((x) => `- ${x}`),
    '',
    `- Questões: **${r.questions.length}** · perguntas: **${items}** · com resposta: **${answered}** (${pct(answered, items)})`,
    r.link ? `- ${linkSummary(r.link)} Método: ${r.link.method}.` : '- Sem gabarito separado (respostas junto das questões).',
    r.answerSectionPage ? `- Seção de respostas detectada na pág. ${r.answerSectionPage}.` : '',
    !answerText ? "- Conferência com o gabarito: não se aplica (respostas junto das questões)." : `- Resposta fiel ao gabarito: **${pct(faithful, answered)}** · no bloco da questão certa: **${pct(inBlock, answered)}** · rótulo certo: **${pct(labelOk, answered)}** · cobertura do gabarito: **${pct(covered, blockChars)}**`,
    `- Tempo de segmentação + ligação: ${ms.toFixed(0)} ms`,
    '',
    problems.length ? `## Problemas (${problems.length})\n\n${problems.map((p) => `- ${p}`).join('\n')}` : '## Problemas\n\nNenhum.',
  ].filter((l) => l !== '')
  console.log(lines.slice(0, 9).join('\n'))
  if (problems.length) console.log(`\n${problems.slice(0, 15).join('\n')}${problems.length > 15 ? `\n… (+${problems.length - 15})` : ''}`)
  const dir = 'samples/private/eval'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const out = `${dir}/relatorio-ligacao-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`
  writeFileSync(out, `${lines.join('\n')}\n`)
  console.log(`\nRelatório: ${out}`)
}

await main()
