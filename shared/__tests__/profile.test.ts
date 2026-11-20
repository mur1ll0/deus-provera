import { describe, expect, it } from 'vitest'
import { accountDeleteInput, cleanLine, profilePatch } from '../schemas/profile'

describe('profilePatch (contrato PATCH /api/profile — spec 001 US3)', () => {
  it('aceita campos parciais e apara espaços', () => {
    expect(profilePatch.parse({ displayName: '  Ana   Beatriz  ' })).toEqual({ displayName: 'Ana Beatriz' })
    expect(profilePatch.parse({ showInRanking: false })).toEqual({ showInRanking: false })
  })

  it('nome de exibição: 2–40 caracteres', () => {
    expect(profilePatch.safeParse({ displayName: 'A' }).success).toBe(false)
    expect(profilePatch.safeParse({ displayName: 'x'.repeat(41) }).success).toBe(false)
    expect(profilePatch.safeParse({ displayName: 'Jo' }).success).toBe(true)
    const r = profilePatch.safeParse({ displayName: ' ' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toMatch(/2 a 40/)
  })

  it('instituição e curso: até 80; vazio vira null (apaga)', () => {
    expect(profilePatch.parse({ institution: '', course: '   ' })).toEqual({ institution: null, course: null })
    expect(profilePatch.parse({ institution: null })).toEqual({ institution: null })
    expect(profilePatch.safeParse({ course: 'c'.repeat(81) }).success).toBe(false)
  })

  it('sanitiza marcação e caracteres invisíveis (US3, cenário 3)', () => {
    expect(profilePatch.parse({ displayName: '<script>alert(1)</script>Ana' })).toEqual({ displayName: 'alert(1)Ana' })
    expect(cleanLine('Ana​\nBeatriz<b>')).toBe('Ana Beatriz')
  })

  it('rejeita objeto vazio e campos desconhecidos são ignorados', () => {
    expect(profilePatch.safeParse({}).success).toBe(false)
    expect(profilePatch.safeParse({ foo: 1 }).success).toBe(false)
  })

  it('onboarded só aceita true', () => {
    expect(profilePatch.safeParse({ onboarded: true }).success).toBe(true)
    expect(profilePatch.safeParse({ onboarded: false }).success).toBe(false)
  })
})

describe('accountDeleteInput (US4)', () => {
  it('exige a palavra EXCLUIR exata', () => {
    expect(accountDeleteInput.safeParse({ confirm: 'EXCLUIR' }).success).toBe(true)
    expect(accountDeleteInput.safeParse({ confirm: 'excluir' }).success).toBe(false)
    expect(accountDeleteInput.safeParse({}).success).toBe(false)
  })
})
