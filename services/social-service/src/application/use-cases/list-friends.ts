import type { FriendshipRepository } from '../ports/friendship-repository.js'

export interface FriendView {
  userId: string
  friendshipId: string
  since: Date
}

/**
 * ListFriends (AC-F3) — the durable source of truth for a user's friends,
 * independent of any event or push. Returns the *other* user in each pair.
 */
export class ListFriends {
  constructor(private readonly friendships: FriendshipRepository) {}

  async execute(me: string): Promise<FriendView[]> {
    const rows = await this.friendships.listForUser(me)
    return rows.map((f) => ({
      userId: f.userA === me ? f.userB : f.userA,
      friendshipId: f.id,
      since: f.createdAt,
    }))
  }
}
