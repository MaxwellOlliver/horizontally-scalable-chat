import { isParticipant } from '../../domain/conversation.js'
import { ConversationNotFoundError, NotParticipantError } from '../../domain/errors.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { ReceiptPointer, ReceiptRepository } from '../ports/receipt-repository.js'

/**
 * GetReceipts: a conversation's current pointers, for resync (§8.3) — the client
 * syncs the pointer, not individual receipt events, then recomputes checkmarks.
 * Participant-only.
 */
export class GetReceipts {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly receipts: ReceiptRepository,
  ) {}

  async execute(me: string, conversationId: string): Promise<ReceiptPointer[]> {
    const conversation = await this.conversations.findById(conversationId)
    if (!conversation) throw new ConversationNotFoundError()
    if (!isParticipant(conversation, me)) throw new NotParticipantError()
    return this.receipts.listForConversation(conversationId)
  }
}
