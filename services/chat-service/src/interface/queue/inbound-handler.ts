import { z } from 'zod'
import { DomainError } from '../../domain/errors.js'
import { safePublish } from '../../application/outbound.js'
import type { OutboundPublisher } from '../../application/ports/outbound-publisher.js'
import type { SendMessage } from '../../application/use-cases/send-message.js'

/**
 * The inbound envelope the gateway publishes to the work queue (spec §2.2): the
 * client's `message.send` plus the gateway-stamped `senderId`. The gateway does
 * NO validation — that is this worker's job.
 */
const inboundSchema = z.object({
  type: z.literal('message.send'),
  clientMsgId: z.string().min(1).max(200),
  senderId: z.string().uuid(),
  toUserId: z.string().uuid(),
  body: z.string(),
})

export interface InboundHandlerDeps {
  sendMessage: SendMessage
  outbound: OutboundPublisher
}

/**
 * Builds the inbound work-queue handler (T3 wiring): parse → SendMessage. A
 * malformed envelope is dropped (acked) since it can never succeed. A domain
 * rejection (gate/validation, AC-M2/M5) is bounced back to the sender as a
 * `message.rejected` frame and then acked — it won't succeed on retry. Any
 * unexpected error propagates so the consumer nacks it (no requeue-loop).
 */
export function createInboundHandler(deps: InboundHandlerDeps) {
  return async (raw: unknown): Promise<void> => {
    const parsed = inboundSchema.safeParse(raw)
    if (!parsed.success) {
      console.error('[chat] dropping malformed inbound message', parsed.error.issues)
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
  }
}
