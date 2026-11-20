import { describe, expect, it } from 'vitest'
import { assertFreeOnly, FREE_ROUTER, TASKS } from '../ai/models'

describe('registro de modelos (princípio III: só gratuitos)', () => {
  it('a configuração atual só tem modelos :free ou o roteador gratuito', () => {
    expect(() => assertFreeOnly()).not.toThrow()
    for (const cfg of Object.values(TASKS)) for (const m of cfg.chain) expect(m === FREE_ROUTER || m.endsWith(':free')).toBe(true)
  })

  it('rejeita um modelo pago na cadeia', () => {
    const tasks = { ...TASKS, explain: { ...TASKS.explain, chain: ['openai/gpt-5', FREE_ROUTER] } }
    expect(() => assertFreeOnly(tasks)).toThrow(/openai\/gpt-5/)
  })
})
