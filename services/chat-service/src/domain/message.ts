/**
 * Message (messaging spec §2.4). The canonical `id` is a server-assigned UUIDv7
 * (authoritative per-conversation order — AC-O1). `clientMsgId` is the sender's
 * optimistic/idempotency key: a retry with the same key returns the original row
 * (AC-M4) and lets the sender's client correlate the `sent` ack (AC-M3).
 */
export interface Message {
  readonly id: string
  readonly conversationId: string
  readonly senderId: string
  readonly clientMsgId: string
  readonly body: string
  readonly createdAt: Date
}

/** Max message body length in characters (spec Decisions §"Max message length"). */
export const MAX_MESSAGE_LENGTH = 4000

/** Whether a body is empty once surrounding whitespace is ignored (AC-M5). */
export function isBlank(body: string): boolean {
  return body.trim().length === 0
}

/** Whether a body exceeds the max length, counted by code points (AC-M5). */
export function isTooLong(body: string): boolean {
  return [...body].length > MAX_MESSAGE_LENGTH
}
