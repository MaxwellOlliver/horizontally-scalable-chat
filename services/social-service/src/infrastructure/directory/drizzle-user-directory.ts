import { eq, inArray } from 'drizzle-orm'
import type { UserDirectory, UserProfile } from '../../application/ports/user-directory.js'
import type { Database } from '../db/client.js'
import { users } from '../db/external.js'

/**
 * Directory lookups against the auth-service's `users` table (read-only;
 * social-service shares the DB but does not own the table — no FK).
 */
export function createDrizzleUserDirectory(db: Database): UserDirectory {
  return {
    async findByEmail(email: string): Promise<UserProfile | null> {
      // `email` is citext, so this match is case-insensitive.
      const [row] = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
      return row ?? null
    },

    async listProfiles(ids: string[]): Promise<UserProfile[]> {
      if (ids.length === 0) return []
      return db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ids))
    },
  }
}
