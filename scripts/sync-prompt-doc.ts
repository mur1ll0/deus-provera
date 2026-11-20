/** Regenera docs/prompts/prompt-agente-externo.md a partir de shared/prompts/external-agent.ts (fonte única). */
import { writeFileSync } from 'node:fs'
import { EXTERNAL_AGENT_PROMPT } from '../shared/prompts/external-agent'

const md = `# Prompt para o agente de IA do usuário

> Gerado por \`npm run prompt:sync\` a partir de \`shared/prompts/external-agent.ts\` — não edite à mão.

Use quando o PDF tiver muitas imagens/páginas escaneadas, quando a cota diária de IA do sistema acabar, ou quando preferir usar o seu ChatGPT/Claude/Gemini.

**Como usar**

1. Abra o agente de IA de sua preferência (ChatGPT, Claude, Gemini, Copilot…).
2. Anexe o PDF.
3. Cole o prompt abaixo e envie.
4. Copie o bloco \`json\` da resposta (ou salve como arquivo) e use **Importar questões → Usar meu agente de IA** (colar ou "Carregar arquivo").
5. O sistema valida o JSON (formato v2), aplica o guardrail e abre a tela de revisão.

---

\`\`\`\`text
${EXTERNAL_AGENT_PROMPT}
\`\`\`\`

## Dicas

- PDFs grandes (> 50 páginas): peça "Parte 1/3" etc. — pode colar todas as partes de uma vez; o sistema junta os blocos.
- Se o agente "resumir" respostas, reforce: *"transcreva literalmente as respostas do PDF"*.
- Se ele criar um assunto diferente para cada questão, reforce: *"use o mesmo assunto amplo para todas as questões do mesmo tema"* (ou use **Agrupar por disciplina** na revisão).
- Validação: cada pergunta objetiva precisa de exatamente 1 alternativa correta; discursivas precisam de \`resposta_esperada\`. Erros aparecem com o caminho do campo (ex.: \`questoes.3.perguntas.1.alternativas\`).
`
writeFileSync('docs/prompts/prompt-agente-externo.md', md)
console.log('docs/prompts/prompt-agente-externo.md atualizado')
