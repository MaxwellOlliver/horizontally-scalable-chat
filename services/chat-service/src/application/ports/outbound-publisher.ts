/**
 * A real-time frame pushed to a user's per-user Redis channel `user:{id}`
 * (messaging spec §2.3) — the same channel the gateway subscribes to. The
 * gateway is a dumb relay: it forwards the frame without understanding it.
 *
 * - `message.received` — a message to render (to the recipient, and echoed to
 *   the sender's other devices — AC-D1/D3).
 * - `message.sent` — the sender's ack: correlates `clientMsgId` → canonical
 *   id + timestamp so the optimistic bubble reconciles (AC-M1/M3).
 * - `message.rejected` — a gated/invalid send bounced back to the sender so the
 *   optimistic bubble can show failed (AC-M2/M5).
 * - `receipt.update` — the recipient's advanced delivered/read high-water marks,
 *   pushed to the sender so it can recompute checkmarks (REQUIREMENTS §4).
 */
export interface OutboundFrame {
  type: 'message.received' | 'message.sent' | 'message.rejected' | 'receipt.update'
  data: Record<string, unknown>
}

/**
 * Publishes outbound frames to a user's connected devices (spec §2.3).
 * Best-effort: an offline user simply has no subscriber and the message waits in
 * the durable store for resync (AC-D2). A failed push MUST NOT undo the persist.
 */
export interface OutboundPublisher {
  publishToUser(userId: string, frame: OutboundFrame): Promise<void>
}
