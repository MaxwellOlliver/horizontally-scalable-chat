import type { FriendshipRepository } from '../ports/friendship-repository.js'
import type { UserDirectory } from '../ports/user-directory.js'

export interface FriendView {
  userId: string
  friendshipId: string
  since: Date
  displayName: string | null
}

/**
 * ListFriends (AC-F3) — the durable source of truth for a user's friends,
 * independent of any event or push. Returns the *other* user in each pair, with
 * their display name resolved from the directory.
 */
export class ListFriends {
  constructor(
    private readonly friendships: FriendshipRepository,
    private readonly users: UserDirectory,
  ) {}

  async execute(me: string): Promise<FriendView[]> {
    const rows = await this.friendships.listForUser(me)
    const otherId = (f: { userA: string; userB: string }) => (f.userA === me ? f.userB : f.userA)

    const profiles = await this.users.listProfiles([...new Set(rows.map(otherId))])
    const nameById = new Map(profiles.map((p) => [p.id, p.displayName]))

    return rows.map((f) => {
      const userId = otherId(f)
      return {
        userId,
        friendshipId: f.id,
        since: f.createdAt,
        displayName: nameById.get(userId) ?? null,
      }
    })
  }
}
