import { and, desc, eq } from 'drizzle-orm'
import { DuplicateRequestError } from '../../domain/errors.js'
import type { FriendRequest, FriendRequestStatus } from '../../domain/friend-request.js'
import type { FriendRequestRepository } from '../../application/ports/friend-request-repository.js'
import type { Database } from '../db/client.js'
import { friendRequests, type FriendRequestRow } from '../db/schema.js'

const UNIQUE_VIOLATION = '23505'

export function createDrizzleFriendRequestRepository(db: Database): FriendRequestRepository {
  return {
    async create(request: FriendRequest): Promise<void> {
      try {
        await db.insert(friendRequests).values({
          id: request.id,
          requesterId: request.requesterId,
          addresseeId: request.addresseeId,
          status: request.status,
          createdAt: request.createdAt,
          respondedAt: request.respondedAt,
        })
      } catch (err) {
        // Partial-unique (pending) violation => a concurrent duplicate (AC-S4).
        if (isUniqueViolation(err)) {
          throw new DuplicateRequestError()
        }
        throw err
      }
    },

    async findById(id: string): Promise<FriendRequest | null> {
      const [row] = await db
        .select()
        .from(friendRequests)
        .where(eq(friendRequests.id, id))
        .limit(1)
      return row ? toDomain(row) : null
    },

    async findPending(requesterId: string, addresseeId: string): Promise<FriendRequest | null> {
      const [row] = await db
        .select()
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, requesterId),
            eq(friendRequests.addresseeId, addresseeId),
            eq(friendRequests.status, 'pending'),
          ),
        )
        .limit(1)
      return row ? toDomain(row) : null
    },

    async transition(
      id: string,
      addresseeId: string,
      to: Extract<FriendRequestStatus, 'accepted' | 'rejected'>,
      at: Date,
    ): Promise<FriendRequest | null> {
      const [row] = await db
        .update(friendRequests)
        .set({ status: to, respondedAt: at })
        .where(
          and(
            eq(friendRequests.id, id),
            eq(friendRequests.addresseeId, addresseeId),
            eq(friendRequests.status, 'pending'),
          ),
        )
        .returning()
      return row ? toDomain(row) : null
    },

    async listPending(
      userId: string,
      direction: 'incoming' | 'outgoing',
    ): Promise<FriendRequest[]> {
      const column =
        direction === 'incoming' ? friendRequests.addresseeId : friendRequests.requesterId
      const rows = await db
        .select()
        .from(friendRequests)
        .where(and(eq(column, userId), eq(friendRequests.status, 'pending')))
        .orderBy(desc(friendRequests.createdAt))
      return rows.map(toDomain)
    },
  }
}

function toDomain(row: FriendRequestRow): FriendRequest {
  return {
    id: row.id,
    requesterId: row.requesterId,
    addresseeId: row.addresseeId,
    status: row.status,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  )
}
