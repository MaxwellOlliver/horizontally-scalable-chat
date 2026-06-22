import { and, eq, or } from 'drizzle-orm'
import { canonicalPair, type Friendship } from '../../domain/friendship.js'
import type { FriendshipRepository } from '../../application/ports/friendship-repository.js'
import type { Database } from '../db/client.js'
import { friendships, type FriendshipRow } from '../db/schema.js'

export function createDrizzleFriendshipRepository(db: Database): FriendshipRepository {
  return {
    async ensure(id: string, userA: string, userB: string, createdAt: Date): Promise<Friendship> {
      // Idempotent insert: a concurrent accept that already created the pair is
      // a no-op here, and we return the existing row (AC-R5/F1).
      const [inserted] = await db
        .insert(friendships)
        .values({ id, userA, userB, createdAt })
        .onConflictDoNothing({ target: [friendships.userA, friendships.userB] })
        .returning()
      if (inserted) {
        return toDomain(inserted)
      }
      const [existing] = await db
        .select()
        .from(friendships)
        .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
        .limit(1)
      // existing is guaranteed present: the insert conflicted on this pair.
      return toDomain(existing!)
    },

    async areFriends(x: string, y: string): Promise<boolean> {
      const { userA, userB } = canonicalPair(x, y)
      const [row] = await db
        .select({ id: friendships.id })
        .from(friendships)
        .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
        .limit(1)
      return row !== undefined
    },

    async listForUser(userId: string): Promise<Friendship[]> {
      const rows = await db
        .select()
        .from(friendships)
        .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)))
      return rows.map(toDomain)
    },

    async remove(x: string, y: string): Promise<Friendship | null> {
      const { userA, userB } = canonicalPair(x, y)
      const [row] = await db
        .delete(friendships)
        .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
        .returning()
      return row ? toDomain(row) : null
    },
  }
}

function toDomain(row: FriendshipRow): Friendship {
  return { id: row.id, userA: row.userA, userB: row.userB, createdAt: row.createdAt }
}
