import { app } from './_server.mjs'

/**
 * Entrada da função Vercel (Node 24, Fluid compute).
 * Um app Hono é um fetch handler — a Vercel invoca `app.fetch` diretamente.
 * Todo /api/* é reescrito para cá (vercel.json); o código das rotas fica em server/.
 *
 * `_server.mjs` é o server/app.ts EMPACOTADO pelo `npm run build:api` (esbuild, roda no `npm run build`):
 * a Vercel compila cada .ts isoladamente e o Node ESM não resolve imports relativos sem extensão
 * (`../server/app` → ERR_MODULE_NOT_FOUND). Pacotes do node_modules ficam externos.
 */
export default app
