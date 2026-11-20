import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'
import { accountDeleteInput, profilePatch } from '../../shared/schemas/profile'
import { auth } from '../auth'
import { requireUser, type AppEnv } from '../middleware'
import { deleteAccount } from '../services/account-deletion'
import { getProfile, updateProfile } from '../services/profile'

/**
 * Perfil e conta — spec 001 › US3/US4. Contrato: specs/001-autenticacao/contracts/api-profile.md.
 * Validação compartilhada com o formulário em shared/schemas/profile.ts.
 */

const validationHook = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    const issues = (result.error as z.ZodError).issues
    throw new HTTPException(400, { message: issues[0]?.message ?? 'Dados inválidos.' })
  }
}

export const profileRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', async (c) => {
    const u = c.get('user')!
    return c.json(await getProfile(u.id, u.name))
  })
  .patch('/', zValidator('json', profilePatch, validationHook), async (c) => {
    const u = c.get('user')!
    return c.json(await updateProfile(u.id, u.name, c.req.valid('json')))
  })

export const accountRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .delete('/', zValidator('json', accountDeleteInput, validationHook), async (c) => {
    const u = c.get('user')!
    // Primeiro a exclusão (se falhar, o usuário continua logado e pode tentar de novo);
    // as linhas de `session` saem na cascata, e o sign-out só apaga os cookies do navegador.
    const result = await deleteAccount(u.id)
    const signOut = await auth().api.signOut({ headers: c.req.raw.headers, asResponse: true }).catch(() => null)
    for (const cookie of signOut?.headers.getSetCookie() ?? []) c.header('set-cookie', cookie, { append: true })
    return c.json({ deleted: true, ...result })
  })

export type ProfileRoutes = typeof profileRoutes
export type AccountRoutes = typeof accountRoutes
