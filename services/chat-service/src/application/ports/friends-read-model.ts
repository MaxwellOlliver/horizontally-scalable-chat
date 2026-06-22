/** The two states of a pair in the local friends read-model (soft-delete). */
export type FriendState = 'active' | 'removed'

export interface FriendsReadModel {
  /** Whether the pair {x, y} are currently active friends (the new-conversation gate, AC-M2). */
  isActive(x: string, y: string): Promise<boolean>

  /**
   * Apply a friend event last-writer-wins by `eventId` (AC-G1). Upserts the
   * canonical `pair` to `state`/`eventId` ONLY if `eventId` is greater than the
   * stored `last_event_id` (or the row is new). Returns whether it was applied,
   * so the caller can skip the conversation state change for stale/duplicate
   * events. `pair` MUST be the canonical pair key (see {@link pairKey}).
   */
  apply(pair: string, state: FriendState, eventId: string, at: Date): Promise<boolean>
}
