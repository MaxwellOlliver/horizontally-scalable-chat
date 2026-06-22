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
}
