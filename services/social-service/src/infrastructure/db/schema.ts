import { sql } from 'drizzle-orm'
import { check, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Friend-request status (spec §2.2). The lifecycle is a single-shot state
 * machine: pending -> accepted | rejected.
 */
export const friendRequestStatus = pgEnum('friend_request_status', [
  'pending',
  'accepted',
  'rejected',
])

/**
 * friend_requests (spec §2.2). `requester_id` / `addressee_id` reference users
 * owned by the auth-service — stored as plain uuids (no cross-service FK).
 *
 * The partial unique index enforces AC-S4: at most one *pending* request per
 * (requester, addressee). A later re-request after rejection is allowed because
 * rejected rows are excluded from the index (AC-S7).
 */
export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').primaryKey(),
    requesterId: uuid('requester_id').notNull(),
    addresseeId: uuid('addressee_id').notNull(),
    status: friendRequestStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('friend_requests_pending_unique')
      .on(t.requesterId, t.addresseeId)
      .where(sql`${t.status} = 'pending'`),
  ],
)

/**
 * friendships (spec §2.2). Symmetric and unique per pair (AC-F1). Stored in
 * canonical order (`user_a < user_b`) so the unique constraint represents the
 * unordered pair, regardless of who requested.
 */
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey(),
    userA: uuid('user_a').notNull(),
    userB: uuid('user_b').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('friendships_pair_unique').on(t.userA, t.userB),
    check('friendships_canonical_order', sql`${t.userA} < ${t.userB}`),
  ],
)

export type FriendRequestRow = typeof friendRequests.$inferSelect
export type FriendshipRow = typeof friendships.$inferSelect
