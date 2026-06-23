import { eq, sql } from 'drizzle-orm'
import type {
  ReceiptPointer,
  ReceiptRepository,
} from '../../application/ports/receipt-repository.js'
import type { Database } from '../db/client.js'
import { messageReceipts, type MessageReceiptRow } from '../db/schema.js'

export function createDrizzleReceiptRepository(db: Database): ReceiptRepository {
  return {
    async advance(conversationId, userId, deliveredUpTo, readUpTo, at): Promise<ReceiptPointer> {
      // GREATEST moves each pointer forward only (idempotent max). GREATEST
      // ignores NULL, so a delivered-only receipt leaves read untouched, and a
      // first receipt sets the value. ::uuid keeps the param/column types aligned.
      const [row] = await db
        .insert(messageReceipts)
        .values({ conversationId, userId, deliveredUpTo, readUpTo, updatedAt: at })
        .onConflictDoUpdate({
          target: [messageReceipts.conversationId, messageReceipts.userId],
          set: {
            deliveredUpTo: sql`GREATEST(${messageReceipts.deliveredUpTo}, ${deliveredUpTo}::uuid)`,
            readUpTo: sql`GREATEST(${messageReceipts.readUpTo}, ${readUpTo}::uuid)`,
            updatedAt: at,
          },
        })
        .returning()
      return toPointer(row!)
    },

    async listForConversation(conversationId): Promise<ReceiptPointer[]> {
      const rows = await db
        .select()
        .from(messageReceipts)
        .where(eq(messageReceipts.conversationId, conversationId))
      return rows.map(toPointer)
    },
  }
}

function toPointer(row: MessageReceiptRow): ReceiptPointer {
  return { userId: row.userId, deliveredUpTo: row.deliveredUpTo, readUpTo: row.readUpTo }
}
