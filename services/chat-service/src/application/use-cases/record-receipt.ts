import { isParticipant } from '../../domain/conversation.js'
import type { Clock } from '../ports/clock.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { OutboundPublisher } from '../ports/outbound-publisher.js'
import type { ReceiptRepository } from '../ports/receipt-repository.js'
import { safePublish } from '../outbound.js'

export interface RecordReceiptInput {
  conversationId: string
  userId: string
  deliveredUpTo?: string
  readUpTo?: string
}

/**
 * RecordReceipt: the recipient reports how far they've `delivered` / `read` a
 * conversation. Advances their high-water marks idempotently (§4.7) and pushes
 * the result to the OTHER participant (the sender), who recomputes checkmarks
 * locally (§4.5). Reading implies delivery, so a read receipt also bumps
 * delivered (the §4.5 invariant delivered_up_to ≥ read_up_to).
 */
export class RecordReceipt {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly receipts: ReceiptRepository,
    private readonly outbound: OutboundPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(input: RecordReceiptInput): Promise<void> {
    const conversation = await this.conversations.findById(input.conversationId)
    if (!conversation || !isParticipant(conversation, input.userId)) {
      return // not a participant — ignore (ephemeral, no error path)
    }

    const read = input.readUpTo ?? null
    let delivered = input.deliveredUpTo ?? null
    if (read && (!delivered || read > delivered)) {
      delivered = read // reading implies delivered (§4.5)
    }
    if (!delivered && !read) return

    const pointer = await this.receipts.advance(
      conversation.id,
      input.userId,
      delivered,
      read,
      this.clock.now(),
    )

    const other = conversation.userA === input.userId ? conversation.userB : conversation.userA
    await safePublish(this.outbound, other, {
      type: 'receipt.update',
      data: {
        conversationId: conversation.id,
        by: input.userId,
        deliveredUpTo: pointer.deliveredUpTo,
        readUpTo: pointer.readUpTo,
      },
    })
  }
}
