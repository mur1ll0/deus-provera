import { expect, test } from '@playwright/test'

/** Spec 003 › T034: prova completa — configurar → responder → o tempo acaba → resultado (auto-finalização). */
test('prova completa: responde, o tempo expira e o resultado aparece', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/simulados')
  await page.getByRole('button', { name: /Modo prova/ }).click()
  await page.getByRole('button', { name: 'Só as minhas' }).click()
  await page.getByRole('button', { name: 'Personalizado' }).click()
  await page.getByRole('spinbutton').fill('1')
  await expect(page.getByText(/disponíveis com esses filtros/)).toContainText('12 disponíveis')
  await page.getByRole('button', { name: 'Começar' }).click()

  await expect(page).toHaveURL(/\/simulados\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('timer')).toBeVisible()
  // Prova: nada de gabarito na tela durante a prova
  await expect(page.getByRole('button', { name: 'Confirmar resposta' })).toHaveCount(0)

  // Responde as 3 primeiras pela tecla A (todas as "Certa" estão na posição A) e navega com →
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('a')
    await page.keyboard.press('ArrowRight')
  }
  await expect(page.getByText('3/10 perguntas respondidas')).toBeVisible()

  // O tempo (1 min) acaba e o executor finaliza sozinho
  await expect(page).toHaveURL(/\/resultado$/, { timeout: 100_000 })
  await expect(page.getByText('3/10')).toBeVisible()
  await expect(page.getByText('Conta para o ranking')).toBeVisible()

  // Histórico mostra a prova finalizada
  await page.goto('/simulados')
  await expect(page.getByText(/Prova · 10 questões/)).toBeVisible()
})

test('treino em 375 px: confirma a resposta e vê o gabarito @mobile', async ({ page }) => {
  await page.goto('/simulados')
  await page.getByRole('button', { name: 'Só as minhas' }).click()
  await page.getByRole('button', { name: 'Começar' }).click()
  await expect(page).toHaveURL(/\/simulados\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: /^A Certa|Certa \d+/ }).first().click()
  await page.getByRole('button', { name: 'Confirmar resposta' }).click()
  await expect(page.getByText(/Explicar com IA/)).toBeVisible()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- roda no navegador
  const overflow = await page.evaluate(() => (globalThis as any).document.documentElement.scrollWidth - (globalThis as any).innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
