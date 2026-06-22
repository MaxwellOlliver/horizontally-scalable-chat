import { createDatabase as createPlatformDatabase } from '@hsc/platform'
import * as schema from './schema.js'

export type Database = ReturnType<typeof createDatabase>

/** Binds the shared Drizzle/postgres factory to auth-service's schema. */
export function createDatabase(connectionString: string) {
  return createPlatformDatabase(connectionString, schema)
}
