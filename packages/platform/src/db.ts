import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * Creates a Drizzle/postgres-js database bound to a service's own schema. Each
 * service owns its tables, so the schema is supplied by the caller; everything
 * else (connection, snake_case casing, graceful close) is identical across
 * services and lives here.
 */
export function createDatabase<TSchema extends Record<string, unknown>>(
  connectionString: string,
  schema: TSchema,
) {
  const sql = postgres(connectionString)
  const db = drizzle(sql, { schema, casing: 'snake_case' })
  return Object.assign(db, {
    /** Close the underlying connection pool (graceful shutdown / tests). */
    close: () => sql.end(),
  })
}
