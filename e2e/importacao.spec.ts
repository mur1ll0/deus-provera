import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/** Spec 002 › T052: agente externo → revisão → salvar → banco de questões; reimportar não duplica. */
test('agente externo: JSON → revisão → salvar → banco de questões', async ({ page }) => {
  const json = {
    versao: '2.0',
    origem: { arquivo: 'e2e.json' },
    questoes: [
      {
        area: 'Medicina',
        disciplina: 'Disciplina E2E',
        assunto: 'Importação E2E',
        enunciado: '[E2E] Paciente com ASCUS. Qual a conduta?',
        perguntas: [{ tipo: 'discursiva', resposta_esperada: 'Repetir a citologia em 6 meses.', pontos_chave: ['repetir citologia'] }],
      },
    ],
  }
  for (const round of [1, 2]) {
    await page.goto('/importar')
    await page.getByText('Usar meu agente de IA').click()
    await page.getByRole('checkbox', { name: /Compartilhar as questões importadas/ }).uncheck()
    await page.getByRole('textbox').last().fill(JSON.stringify(json))
    await page.getByRole('button', { name: 'Validar e revisar →' }).click()
    await expect(page.getByText('1 questão', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Confirmar e salvar 1/ }).click()
    if (round === 1) await expect(page.getByRole('heading', { name: '1 questão salva!' })).toBeVisible()
    else await expect(page.getByText(/1 já estava no seu banco/)).toBeVisible()
  }
  await page.goto('/questoes')
  await expect(page.getByText('[E2E] Paciente com ASCUS. Qual a conduta?')).toHaveCount(1)
})

/**
 * Marco S2 (opt-in: E2E_AI=1): os PDFs de exemplo pelo fluxo real — extração no navegador, visão das imagens,
 * pipeline de IA no servidor (OpenRouter), revisão e salvar. Conteúdo de terceiros: importado como privado e
 * apagado no teardown.
 */
for (const pdf of ['Unidade II.pdf', 'III UNIDADE.pdf']) {
  test(`PDF com IA real: ${pdf}`, async ({ page }) => {
    test.skip(process.env.E2E_AI !== '1' || !existsSync(pdf), 'defina E2E_AI=1 (usa a cota do OpenRouter) e tenha o PDF na raiz')
    test.setTimeout(75 * 60_000)
    await page.goto('/importar')
    await page.getByRole('checkbox', { name: /Compartilhar as questões importadas/ }).uncheck()
    await page.locator('input[type=file]').first().setInputFiles(pdf)
    const vision = page.getByRole('checkbox', { name: /Transcrever as \d+ imagens/ })
    if (await vision.count()) await vision.check()
    await page.getByRole('button', { name: 'Processar com IA →' }).click()
    await expect(page.getByRole('button', { name: /Confirmar e salvar \d+/ })).toBeVisible({ timeout: 70 * 60_000 })
    const total = Number((await page.getByRole('button', { name: /Confirmar e salvar \d+/ }).textContent())!.match(/\d+/)![0])
    // Questões sem resposta/classificação bloqueiam: tira as com problema (decisão T040) e salva o resto
    await page.getByRole('button', { name: /Confirmar e salvar/ }).click()
    const drop = page.getByRole('button', { name: /Tirar \d+ quest/ })
    if (await drop.count()) {
      await drop.click()
      await page.getByRole('button', { name: /Confirmar e salvar/ }).click()
    }
    const cardFix = page.getByRole('button', { name: 'Editar card' })
    if (await cardFix.count()) test.info().annotations.push({ type: 'aviso', description: 'Card "Revisar categoria" precisou de classificação manual' })
    await expect(page.getByRole('heading', { name: /quest(ão|ões) salvas?!/ })).toBeVisible({ timeout: 120_000 })
    const saved = Number((await page.getByRole('heading', { name: /salvas?!/ }).textContent())!.match(/\d+/)![0])
    test.info().annotations.push({ type: 'resultado', description: `${pdf}: ${saved} salvas de ${total} na revisão` })
    expect(saved).toBeGreaterThan(total * 0.6)
  })
}
