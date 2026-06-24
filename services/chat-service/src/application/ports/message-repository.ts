import type { Message } from '../../domain/message.js'

export interface MessagePage {
  /** Fetch at most this many messages. */
  limit: number
  /** Exclusive upper-bound cursor: only messages with `id < before` (older). */
  before?: string
}

export interface MessageRepository {
  /**
   * Idempotent insert keyed on `(sender_id, client_msg_id)`. A retried send
   * returns the original row with `created: false` (AC-M4); a first send inserts
   * and returns `created: true`.
   */
  insert(message: Message): Promise<{ message: Message; created: boolean }>

  /**
   * A page of a conversation's messages, most-recent-first by UUIDv7 (AC-H1/H2).
   * `before` is an exclusive cursor for keyset pagination.
   */
  page(conversationId: string, opts: MessagePage): Promise<Message[]>

  /**
   * The latest message in each of the given conversations (one row per
   * conversation that has any), for conversation-list previews.
   */
  latestByConversations(conversationIds: string[]): Promise<Message[]>

  /**
   * Per-conversation count of messages `userId` hasn't read yet — messages from
   * the OTHER participant with id greater than that user's `read_up_to` (all of
   * them when there's no read pointer). Conversations with nothing unread are
   * absent from the map. Drives the conversation-list unread badge (§4.4).
   */
  unreadCounts(userId: string, conversationIds: string[]): Promise<Map<string, number>>
}
