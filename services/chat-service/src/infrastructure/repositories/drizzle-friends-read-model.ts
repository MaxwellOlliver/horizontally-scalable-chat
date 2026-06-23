import { eq, lt } from 'drizzle-orm'
import { pairKey } from '../../domain/conversation.js'
import type {
  FriendsReadModel,
  FriendState,
} from '../../application/ports/friends-read-model.js'
import type { Database } from '../db/client.js'
import { friendsReadModel } from '../db/schema.js'

export function createDrizzleFriendsReadModel(db: Database): FriendsReadModel {
  return {
    async isActive(x: string, y: string): Promise<boolean> {
      const [row] = await db
        .select({ state: friendsReadModel.state })
        .from(friendsReadModel)
        .where(eq(friendsReadModel.pair, pairKey(x, y)))
        .limit(1)
      return row?.state === 'active'
    },

    async apply(
      pair: string,
      state: FriendState,
      eventId: string,
      at: Date,
    ): Promise<boolean> {
      // Upsert last-writer-wins by eventId: insert when new, otherwise update
      // ONLY if this event is newer than the stored one. When the conditional
      // update is skipped (stale/duplicate), RETURNING yields no row (AC-G1).
      const [row] = await db
        .insert(friendsReadModel)
        .values({ pair, state, lastEventId: eventId, updatedAt: at })
        .onConflictDoUpdate({
          target: friendsReadModel.pair,
          set: { state, lastEventId: eventId, updatedAt: at },
          setWhere: lt(friendsReadModel.lastEventId, eventId),
        })
        .returning({ pair: friendsReadModel.pair })
      return row !== undefined
    },
  }
}
