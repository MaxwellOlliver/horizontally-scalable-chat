/**
 * A real-time frame pushed to a user's per-user Redis channel (spec §2.4b).
 * Same envelope family as chat messages; the gateway forwards it without
 * understanding friend semantics.
 */
export interface LiveFrame {
  type: 'friend_request.received' | 'friend_request.accepted' | 'friendship.removed'
  data: Record<string, string>
}

/**
 * Pushes a list-update frame to a user's connected devices (spec §2.4b).
 * Best-effort: an offline user simply has no subscriber and reflects the change
 * on next list load (AC-P5). Failures MUST NOT fail the mutation.
 */
export interface LivePush {
  pushToUser(userId: string, frame: LiveFrame): Promise<void>
}
