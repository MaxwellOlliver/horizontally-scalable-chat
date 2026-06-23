import { z } from 'zod'
import { DomainError } from '../../domain/errors.js'
import { safePublish } from '../../application/outbound.js'
import type { OutboundPublisher } from '../../application/ports/outbound-publisher.js'
import type { RecordReceipt } from '../../application/use-cases/record-receipt.js'
import type { SendMessage } from '../../application/use-cases/send-message.js'

/**
 * The client's `message.send` plus the gateway-stamped `senderId` (spec §2.2).
 * The gateway does NO validation — that is this worker's job.
 */
const messageSchema = z.object({
  type: z.literal('message.send'),
  clientMsgId: z.string().min(1).max(200),
  senderId: z.string().uuid(),
  toUserId: z.string().uuid(),
  body: z.string(),
})

/**
 * A delivery/read receipt the recipient reports, stamped with their `userId`
 * (REQUIREMENTS §4). Ephemeral — a malformed one is just dropped.
 */
const receiptSchema = z.object({
  type: z.literal('receipt'),
  userId: z.string().uuid(),
  conversationId: z.string().uuid(),
  deliveredUpTo: z.string().uuid().optional(),
  readUpTo: z.string().uuid().optional(),
})

export interface InboundHandlerDeps {
  sendMessage: SendMessage
  recordReceipt: RecordReceipt
  outbound: OutboundPublisher
}

/**
 * Builds the inbound work-queue handler: routes by `type`. `message.send` →
 * SendMessage (a domain rejection bounces a `message.rejected` to the sender and
 * is acked; an unexpected error propagates so the consumer nacks). `receipt` →
 * RecordReceipt (advance the recipient's pointers, push to the sender). Anything
 * malformed/unknown is dropped (acked) — it can never succeed.
 */
export function createInboundHandler(deps: InboundHandlerDeps) {
  return async (raw: unknown): Promise<void> => {
    const type = (raw as { type?: unknown } | null)?.type

    if (type === 'message.send') {
      const parsed = messageSchema.safeParse(raw)
      if (!parsed.success) {
        console.error('[chat] dropping malformed message', parsed.error.issues)
        return
      }
      const envelope = parsed.data
      try {
        await deps.sendMessage.execute({
          clientMsgId: envelope.clientMsgId,
          senderId: envelope.senderId,
          toUserId: envelope.toUserId,
          body: envelope.body,
        })
      } catch (err) {
        if (err instanceof DomainError) {
          await safePublish(deps.outbound, envelope.senderId, {
            type: 'message.rejected',
            data: { clientMsgId: envelope.clientMsgId, reason: err.code, message: err.message },
          })
          return
        }
        throw err // unexpected (DB/infra) — let the consumer nack
      }
      return
    }

    if (type === 'receipt') {
      const parsed = receiptSchema.safeParse(raw)
      if (!parsed.success) {
        console.error('[chat] dropping malformed receipt', parsed.error.issues)
        return
      }
      await deps.recordReceipt.execute({
        conversationId: parsed.data.conversationId,
        userId: parsed.data.userId,
        deliveredUpTo: parsed.data.deliveredUpTo,
        readUpTo: parsed.data.readUpTo,
      })
      return
    }

    console.error('[chat] dropping unknown inbound envelope', { type })
  }
}
