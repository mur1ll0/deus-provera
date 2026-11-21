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
 * "Cliquei em Confirmar e nada aconteceu": com muitos cards o aviso de problemas fica no fim da página.
 * Ao salvar com item inválido, o resumo aparece na barra do botão e a tela rola até o aviso.
 * Rótulos longos do contrato ("Paciente 1", até 10) não podem bloquear o commit.
 */
test('revisão: item inválido aparece junto ao botão e o aviso entra na tela @mobile', async ({ page }) => {
  const questoes = Array.from({ length: 8 }, (_, i) => ({
    area: i === 7 ? 'Sem área' : 'Medicina',
    disciplina: 'Disciplina E2E',
    assunto: `Assunto E2E ${i + 1}`,
    enunciado: `[E2E] Caso ${i + 1}: paciente com queixa ginecológica. Responda:`,
    perguntas: [1, 2].map((n) => ({ rotulo: `Paciente ${n}`, texto: `Conduta ${n}?`, tipo: 'discursiva', resposta_esperada: `Conduta ${n}.` })),
  }))
  await page.goto('/importar')
  await page.getByText('Usar meu agente de IA').click()
  await page.getByRole('checkbox', { name: /Compartilhar as questões importadas/ }).uncheck()
  await page.getByRole('textbox').last().fill(JSON.stringify({ versao: '2.0', origem: { arquivo: 'e2e-problemas.json' }, questoes }))
  await page.getByRole('button', { name: 'Validar e revisar →' }).click()
  await page.getByRole('button', { name: /Confirmar e salvar 8/ }).click()
  // Só o card sem área bloqueia (os rótulos "Paciente N" passam).
  await expect(page.getByRole('button', { name: /1 item precisa de ajuste — ver/ })).toBeVisible()
  const alert = page.getByRole('alert', { name: 'Ajuste estes itens antes de salvar' })
  await expect(alert).toBeInViewport()
  await expect(alert.getByRole('listitem')).toHaveCount(1)
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
    // O que a IA não classificou fica em "Revisar categoria": o usuário escolhe área e disciplina do card (como faria na tela)
    const problems = page.getByRole('alert', { name: 'Ajuste estes itens antes de salvar' })
    if (await problems.isVisible()) {
      const left = await page.getByRole('heading', { name: 'Revisar categoria' }).count()
      test.info().annotations.push({ type: 'aviso', description: `${pdf}: card "Revisar categoria" classificado à mão (${left} card)` })
      await problems.getByRole('button', { name: 'Editar card' }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Área').fill('Medicina')
      await dialog.getByLabel('Disciplina').fill('Ginecologia')
      await dialog.getByRole('button', { name: 'Salvar card' }).click()
      await page.getByRole('button', { name: /Confirmar e salvar/ }).click()
    }
    await expect(page.getByRole('heading', { name: /quest(ão|ões) salvas?!/ })).toBeVisible({ timeout: 120_000 })
    const saved = Number((await page.getByRole('heading', { name: /salvas?!/ }).textContent())!.match(/\d+/)![0])
    test.info().annotations.push({ type: 'resultado', description: `${pdf}: ${saved} salvas de ${total} na revisão` })
    expect(saved).toBeGreaterThan(total * 0.6)
  })
}
