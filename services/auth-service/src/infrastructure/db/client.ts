import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Database = ReturnType<typeof createDatabase>

export function createDatabase(connectionString: string) {
  const sql = postgres(connectionString)
  const db = drizzle(sql, { schema, casing: 'snake_case' })
  return Object.assign(db, {
    /** Close the underlying connection pool (graceful shutdown / tests). */
    close: () => sql.end(),
  })
}
