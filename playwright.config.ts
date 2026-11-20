import { defineConfig, devices } from '@playwright/test'

/**
 * Testes E2E (spec 003 › T034, spec 002 › T052): SPA + API real (`npm run dev:api`, porta 3000) + Postgres do .env.
 * O login Google é substituído por uma sessão criada no banco (e2e/global-setup.ts) — tudo apagado no fim.
 *
 *   npm run test:e2e              → fluxos principais (sem IA)
 *   E2E_AI=1 npm run test:e2e     → + importação dos PDFs de exemplo com a IA real (marco S2; ~10 min e ~70 requisições por PDF)
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    storageState: 'e2e/.auth/state.json',
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'npm run dev:api',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
