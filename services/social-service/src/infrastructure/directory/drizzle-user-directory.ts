import { sql } from 'drizzle-orm'
import type { UserDirectory } from '../../application/ports/user-directory.js'
import type { Database } from '../db/client.js'

/**
 * Existence check against the auth-service's `users` table (AC-S6). Read-only:
 * social-service shares the Postgres instance but does not own this table, so
 * there is no foreign key — just a directory lookup.
 */
export function createDrizzleUserDirectory(db: Database): UserDirectory {
  return {
    async exists(userId: string): Promise<boolean> {
      const rows = await db.execute(sql`select 1 from users where id = ${userId} limit 1`)
      return rows.length > 0
    },
  }
}
