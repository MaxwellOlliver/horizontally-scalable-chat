import type { Friendship } from '../../domain/friendship.js'

export interface FriendshipRepository {
  /**
   * Inserts the friendship in canonical order, idempotently (INSERT ... ON
   * CONFLICT DO NOTHING). Returns the existing or newly-created row, so two
   * racing accepts both succeed but only one friendship exists (AC-R5/F1).
   * `userA`/`userB` MUST already be in canonical order (userA < userB).
   */
  ensure(id: string, userA: string, userB: string, createdAt: Date): Promise<Friendship>

  /** AC-F2 — the friendship check consumed by the Messaging gate. */
  areFriends(x: string, y: string): Promise<boolean>

  /** AC-F3 — all friendships a user is part of. */
  listForUser(userId: string): Promise<Friendship[]>

  /**
   * AC-U1/U2 — hard-deletes the friendship for the (unordered) pair {x, y} and
   * returns the deleted row, or null when none existed (no-op ⇒ 404). The
   * returned row carries both user ids for the removed event and the two pushes.
   */
  remove(x: string, y: string): Promise<Friendship | null>
}
