import { inArray } from 'drizzle-orm'
import type { UserDirectory, UserProfile } from '../../application/ports/user-directory.js'
import type { Database } from '../db/client.js'
import { users } from '../db/external.js'

export function createDrizzleUserDirectory(db: Database): UserDirectory {
  return {
    async listProfiles(ids: string[]): Promise<UserProfile[]> {
      if (ids.length === 0) return []
      return db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ids))
    },
  }
}
