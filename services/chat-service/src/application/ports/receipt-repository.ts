/** A user's two high-water marks in a conversation (REQUIREMENTS §4.4). */
export interface ReceiptPointer {
  userId: string
  deliveredUpTo: string | null
  readUpTo: string | null
}

export interface ReceiptRepository {
  /**
   * Advance a user's pointers idempotently — each column moves to the greater of
   * its current value and the incoming one (`max()`, §4.7), so duplicate/retried
   * or reordered receipts are harmless. Returns the resulting pointer.
   */
  advance(
    conversationId: string,
    userId: string,
    deliveredUpTo: string | null,
    readUpTo: string | null,
    at: Date,
  ): Promise<ReceiptPointer>

  /** Both participants' pointers for a conversation (for resync, §8.3). */
  listForConversation(conversationId: string): Promise<ReceiptPointer[]>
}
