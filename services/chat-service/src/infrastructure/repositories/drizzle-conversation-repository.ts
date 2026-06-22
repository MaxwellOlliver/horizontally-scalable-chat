import { and, eq } from 'drizzle-orm'
import type { Conversation } from '../../domain/conversation.js'
import type { ConversationRepository } from '../../application/ports/conversation-repository.js'
import type { Database } from '../db/client.js'
import { conversations, type ConversationRow } from '../db/schema.js'

export function createDrizzleConversationRepository(db: Database): ConversationRepository {
  return {
    async findByPair(userA: string, userB: string): Promise<Conversation | null> {
      const [row] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
        .limit(1)
      return row ? toDomain(row) : null
    },

    async findById(id: string): Promise<Conversation | null> {
      const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
      return row ? toDomain(row) : null
    },

    async create(id: string, userA: string, userB: string, createdAt: Date): Promise<Conversation> {
      // Idempotent get-or-create: a concurrent first-message race conflicts on
      // the canonical pair and we return the existing row.
      const [inserted] = await db
        .insert(conversations)
        .values({ id, userA, userB, state: 'open', createdAt })
        .onConflictDoNothing({ target: [conversations.userA, conversations.userB] })
        .returning()
      if (inserted) {
        return toDomain(inserted)
      }
      const [existing] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
        .limit(1)
      return toDomain(existing!)
    },

    async close(userA: string, userB: string): Promise<void> {
      await db
        .update(conversations)
        .set({ state: 'closed' })
        .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
    },

    async reopen(userA: string, userB: string): Promise<void> {
      // Only flip a CLOSED one back to open — never create on re-friend; the
      // conversation is created lazily on the next message (AC-G3).
      await db
        .update(conversations)
        .set({ state: 'open' })
        .where(
          and(
            eq(conversations.userA, userA),
            eq(conversations.userB, userB),
            eq(conversations.state, 'closed'),
          ),
        )
    },
  }
}

function toDomain(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userA: row.userA,
    userB: row.userB,
    state: row.state,
    createdAt: row.createdAt,
  }
}
