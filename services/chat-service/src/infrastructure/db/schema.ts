import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/** Conversation gate state (spec §2.4): open <-> closed on un-friend/re-friend. */
export const conversationState = pgEnum('conversation_state', ['open', 'closed'])

/** Friends read-model soft-delete state (spec §2.6). */
export const friendState = pgEnum('friend_state', ['active', 'removed'])

/**
 * conversations (spec §2.4). One row per canonical pair (`user_a < user_b`), so
 * the unordered pair {x, y} has a single representation and a single thread.
 * `user_a` / `user_b` reference users owned by auth-service — plain uuids, no
 * cross-service FK.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    userA: uuid('user_a').notNull(),
    userB: uuid('user_b').notNull(),
    state: conversationState('state').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_pair_unique').on(t.userA, t.userB),
    check('conversations_canonical_order', sql`${t.userA} < ${t.userB}`),
  ],
)

/**
 * messages (spec §2.4). `id` is the server-assigned UUIDv7 (authoritative order,
 * AC-O1). The `(conversation_id, id)` index serves keyset history pagination
 * (AC-H1/H2); the partial-free unique `(sender_id, client_msg_id)` is the
 * idempotency key for retried sends (AC-M4).
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    senderId: uuid('sender_id').notNull(),
    clientMsgId: text('client_msg_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_id_idx').on(t.conversationId, t.id),
    uniqueIndex('messages_sender_client_msg_unique').on(t.senderId, t.clientMsgId),
  ],
)

/**
 * friends_read_model (spec §2.6). chat-service's own durable projection of
 * friendship state, fed by `friend_request.accepted` / `friendship.removed`.
 * `last_event_id` is the UUIDv7 of the last applied event; updates are
 * last-writer-wins by it (AC-G1), making the projection idempotent / reorder-safe.
 */
export const friendsReadModel = pgTable('friends_read_model', {
  pair: text('pair').primaryKey(),
  state: friendState('state').notNull(),
  lastEventId: uuid('last_event_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ConversationRow = typeof conversations.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type FriendsReadModelRow = typeof friendsReadModel.$inferSelect
