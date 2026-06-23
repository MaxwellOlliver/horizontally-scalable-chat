import type { FriendRequestRepository } from '../ports/friend-request-repository.js'
import type { UserDirectory } from '../ports/user-directory.js'

export interface PendingRequestView {
  requestId: string
  requesterId: string
  addresseeId: string
  createdAt: Date
  /** The counterpart (the requester for incoming, the addressee for outgoing). */
  otherUser: { id: string; displayName: string | null }
}

/**
 * ListPendingRequests (AC-F3) — incoming or outgoing pending requests. This is
 * the inbox; its count is the badge (no separate notifications feature). The
 * counterpart's name is resolved so the list reads as people, not uuids.
 */
export class ListPendingRequests {
  constructor(
    private readonly friendRequests: FriendRequestRepository,
    private readonly users: UserDirectory,
  ) {}

  async execute(
    me: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<PendingRequestView[]> {
    const rows = await this.friendRequests.listPending(me, direction)
    const otherId = (r: { requesterId: string; addresseeId: string }) =>
      direction === 'incoming' ? r.requesterId : r.addresseeId

    const profiles = await this.users.listProfiles([...new Set(rows.map(otherId))])
    const nameById = new Map(profiles.map((p) => [p.id, p.displayName]))

    return rows.map((r) => {
      const id = otherId(r)
      return {
        requestId: r.id,
        requesterId: r.requesterId,
        addresseeId: r.addresseeId,
        createdAt: r.createdAt,
        otherUser: { id, displayName: nameById.get(id) ?? null },
      }
    })
  }
}
