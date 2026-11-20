import { z } from 'zod'
import { normalizeText } from '../guardrails'

/**
 * Contrato do perfil (`PATCH /api/profile`) — spec 001 › US3 (FR-007/FR-008) e T020 (aviso único).
 * Usado no servidor (validação) e no cliente (mesmas regras do formulário).
 */

export const PROFILE_LIMITS = { displayNameMin: 2, displayName: 40, institution: 80, course: 80 } as const

/**
 * Campo de uma linha vindo do usuário: normaliza (guardrails), remove marcação HTML,
 * junta espaços/quebras de linha e apara. Mesmo assim é SEMPRE renderizado como texto puro.
 */
export function cleanLine(s: string): string {
  return normalizeText(s)
    .replace(/<[^>]*>?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const line = (max: number) => z.string().max(max * 4).transform(cleanLine).pipe(z.string().max(max, { error: `Use no máximo ${max} caracteres.` }))
/** Opcional: vazio vira `null` (apaga o campo). */
const optLine = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .transform((s) => (s == null ? null : cleanLine(s) || null))
    .pipe(z.string().max(max, { error: `Use no máximo ${max} caracteres.` }).nullable())

export const profilePatch = z
  .object({
    displayName: line(PROFILE_LIMITS.displayName).pipe(
      z.string().min(PROFILE_LIMITS.displayNameMin, { error: `O nome de exibição precisa de ${PROFILE_LIMITS.displayNameMin} a ${PROFILE_LIMITS.displayName} caracteres.` }),
    ),
    institution: optLine(PROFILE_LIMITS.institution),
    course: optLine(PROFILE_LIMITS.course),
    showInRanking: z.boolean(),
    /** Aviso único do ranking/privacidade visto (grava `onboarded_at` e `privacy_ack_at`). */
    onboarded: z.literal(true),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { error: 'Nada para atualizar.' })

export type ProfilePatch = z.input<typeof profilePatch>
export type ProfilePatchParsed = z.output<typeof profilePatch>

/** Confirmação digitada da exclusão de conta (US4). */
export const ACCOUNT_DELETE_CONFIRM = 'EXCLUIR'
export const accountDeleteInput = z.object({
  confirm: z.literal(ACCOUNT_DELETE_CONFIRM, { error: `Digite ${ACCOUNT_DELETE_CONFIRM} para confirmar.` }),
})
