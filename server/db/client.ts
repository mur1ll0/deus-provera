import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { env } from '../env'
import * as schema from './schema'

/**
 * Driver HTTP do Neon: ideal para funções serverless (sem pool de conexões persistente).
 * Para operações multi-statement atômicas use `db.batch([...])` (suportado no neon-http).
 */
let instance: ReturnType<typeof create> | null = null

function create() {
  return drizzle(neon(env().DATABASE_URL), { schema, casing: 'snake_case' })
}

export function db() {
  instance ??= create()
  return instance
}

export { schema }
