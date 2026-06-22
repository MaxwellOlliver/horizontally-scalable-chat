import { and, desc, eq, lt } from 'drizzle-orm'
import type { Message } from '../../domain/message.js'
import type {
  MessagePage,
  MessageRepository,
} from '../../application/ports/message-repository.js'
import type { Database } from '../db/client.js'
import { messages, type MessageRow } from '../db/schema.js'

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
        .where(and(eq(messages.senderId, message.senderId), eq(messages.clientMsgId, message.clientMsgId)))
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
