import { app } from '../server/app'

/**
 * Entrada da função Vercel (Node 24, Fluid compute).
 * Um app Hono é um fetch handler — a Vercel invoca `app.fetch` diretamente.
 * Todo /api/* é reescrito para cá (vercel.json); o código das rotas fica em server/
 * para não virar uma função por arquivo.
 */
export default app
