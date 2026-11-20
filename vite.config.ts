import { fileURLToPath, URL } from 'node:url'
import { getRequestListener } from '@hono/node-server'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * `npm run dev:api` (modo "api"): o próprio Vite serve a API Hono em /api/* na MESMA origem
 * (http://localhost:3000), como a Vercel faz em produção — login Google e cookies funcionam
 * sem precisar de `vercel dev`/conta Vercel. O código do servidor recarrega a cada edição (ssrLoadModule).
 */
function honoDevApi(): Plugin {
  return {
    name: 'deus-provera:hono-dev-api',
    apply: 'serve',
    configureServer(server) {
      const listener = getRequestListener(async (req) => {
        const { app } = (await server.ssrLoadModule('/server/app.ts')) as { app: { fetch: (r: Request) => Response | Promise<Response> } }
        return app.fetch(req)
      })
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/') && req.url !== '/api') return next()
        listener(req, res).catch(next)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const withApi = mode === 'api'
  if (withApi) {
    // Variáveis do servidor (.env/.env.local, sem prefixo VITE_) só no processo Node — nunca no bundle.
    for (const [k, v] of Object.entries(loadEnv('development', process.cwd(), ''))) process.env[k] ??= v
  }
  return {
    plugins: [react(), tailwindcss(), ...(withApi ? [honoDevApi()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    server: withApi
      ? // Porta fixa: é a do BETTER_AUTH_URL e do callback OAuth registrado no Google.
        { port: 3000, strictPort: true }
      : // Protótipo sem backend (login simulado como fallback).
        { port: 5173 },
  }
})
