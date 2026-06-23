import type { Conversation } from '../../domain/conversation.js'

export interface ConversationRepository {
  /** Every conversation the user participates in (for the conversation list). */
  listForUser(userId: string): Promise<Conversation[]>

  /** The conversation for a canonical pair, or null if none exists yet. */
  findByPair(userA: string, userB: string): Promise<Conversation | null>

  /** A conversation by id (history reads), or null if unknown. */
  findById(id: string): Promise<Conversation | null>

  /**
   * Lazily get-or-create the `open` conversation for a canonical pair (AC-M2,
   * messaging spec §2.6). Idempotent on the unique pair: a concurrent create
   * returns the existing row. `userA`/`userB` MUST be canonical (userA < userB).
   */
  create(id: string, userA: string, userB: string, createdAt: Date): Promise<Conversation>

  /** Close the pair's conversation if one exists (un-friend revocation, AC-G2). */
  close(userA: string, userB: string): Promise<void>

  /** Reopen the pair's conversation only if it is currently closed (re-friend, AC-G3). */
  reopen(userA: string, userB: string): Promise<void>
}
