import type { OutboundFrame, OutboundPublisher } from './ports/outbound-publisher.js'

/**
 * Best-effort outbound. The message is already durably persisted before this
 * runs (AC-M1); a Redis hiccup or an offline (subscriber-less) recipient must
 * not fail the send or undo the persist — the durable store + resync (AC-D2)
 * are the source of truth. Failures are logged, never thrown.
 */
export async function safePublish(
  publisher: OutboundPublisher,
  userId: string,
  frame: OutboundFrame,
): Promise<void> {
  try {
    await publisher.publishToUser(userId, frame)
  } catch (err) {
    console.error(`[chat] outbound publish failed: ${frame.type} -> ${userId}`, err)
  }
}
