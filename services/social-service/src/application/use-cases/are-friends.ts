import type { FriendshipRepository } from '../ports/friendship-repository.js'

/**
 * AreFriends (AC-F2) — the friendship check consumed by the Messaging gate.
 */
export class AreFriends {
  constructor(private readonly friendships: FriendshipRepository) {}

  execute(x: string, y: string): Promise<boolean> {
    return this.friendships.areFriends(x, y)
  }
}
