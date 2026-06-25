import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { Message } from '../../domain/message.js'
import type { MessagePage, MessageRepository } from '../../application/ports/message-repository.js'
import type { Database } from '../db/client.js'
import { messageReceipts, messages, type MessageRow } from '../db/schema.js'

export function createDrizzleMessageRepository(db: Database): MessageRepository {
  return {
    async insert(message: Message): Promise<{ message: Message; created: boolean }> {
      // Idempotent on (sender_id, client_msg_id): a retried send conflicts and
      // we return the original row (AC-M4).
      const [inserted] = await db
        .insert(messages)
        .values({
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          clientMsgId: message.clientMsgId,
          body: message.body,
          createdAt: message.createdAt,
        })
        .onConflictDoNothing({ target: [messages.senderId, messages.clientMsgId] })
        .returning()
      if (inserted) {
        return { message: toDomain(inserted), created: true }
      }
      const [existing] = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.senderId, message.senderId),
            eq(messages.clientMsgId, message.clientMsgId),
          ),
        )
        .limit(1)
      // Guaranteed present: the insert conflicted on this (sender, clientMsgId).
      return { message: toDomain(existing!), created: false }
    },

    async page(conversationId: string, opts: MessagePage): Promise<Message[]> {
      const conditions = [eq(messages.conversationId, conversationId)]
      if (opts.before) {
        conditions.push(lt(messages.id, opts.before)) // keyset: older than cursor
      }
      const rows = await db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.id)) // most-recent-first (AC-H1/H2)
        .limit(opts.limit)
      return rows.map(toDomain)
    },

    async latestByConversations(conversationIds: string[]): Promise<Message[]> {
      if (conversationIds.length === 0) return []
      // DISTINCT ON (conversation_id) + ORDER BY id DESC => the newest message per
      // conversation in one pass (uses the (conversation_id, id) index).
      const rows = await db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .orderBy(messages.conversationId, desc(messages.id))
      return rows.map(toDomain)
    },

    async unreadCounts(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
      if (conversationIds.length === 0) return new Map()
      // Count partner messages above this user's read mark. LEFT JOIN their
      // receipt row so a conversation with no pointer counts every partner
      // message (read_up_to IS NULL).
      const rows = await db
        .select({
          conversationId: messages.conversationId,
          count: sql<number>`count(*)::int`,
        })
        .from(messages)
        .leftJoin(
          messageReceipts,
          and(
            eq(messageReceipts.conversationId, messages.conversationId),
            eq(messageReceipts.userId, userId),
          ),
        )
        .where(
          and(
            inArray(messages.conversationId, conversationIds),
            ne(messages.senderId, userId),
            or(isNull(messageReceipts.readUpTo), gt(messages.id, messageReceipts.readUpTo)),
          ),
        )
        .groupBy(messages.conversationId)
      return new Map(rows.map((r) => [r.conversationId, r.count]))
    },
  }
}

function toDomain(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    clientMsgId: row.clientMsgId,
    body: row.body,
    createdAt: row.createdAt,
  }
}
