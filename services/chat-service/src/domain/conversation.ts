/**
 * Conversation (messaging spec §2.4): a 1:1 thread between a canonical pair of
 * users, with an open/closed gate. Stored in canonical order (`userA < userB`)
 * so the unordered pair {x, y} maps to exactly one row. `closed` is the
 * un-friend revocation state (AC-G2); re-friend flips it back to `open` (AC-G3).
 */
export type ConversationState = 'open' | 'closed'

export interface Conversation {
  readonly id: string
  readonly userA: string
  readonly userB: string
  readonly state: ConversationState
  readonly createdAt: Date
}

/**
 * Orders two user ids canonically (userA < userB) so a pair maps to a single
 * row regardless of who sent first. UUIDs compare lexicographically.
 */
export function canonicalPair(x: string, y: string): { userA: string; userB: string } {
  return x < y ? { userA: x, userB: y } : { userA: y, userB: x }
}

/**
 * The canonical pair key used by the friends read-model PK (`a_b`). Same
 * ordering as {@link canonicalPair}, joined so a pair has one string identity.
 */
export function pairKey(x: string, y: string): string {
  const { userA, userB } = canonicalPair(x, y)
  return `${userA}_${userB}`
}

/** Whether `userId` is one of the conversation's two participants (AC-H3). */
export function isParticipant(conversation: Conversation, userId: string): boolean {
  return conversation.userA === userId || conversation.userB === userId
}
