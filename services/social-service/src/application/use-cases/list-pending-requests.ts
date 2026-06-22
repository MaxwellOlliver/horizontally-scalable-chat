import type { FriendRequestRepository } from '../ports/friend-request-repository.js'

export interface PendingRequestView {
  requestId: string
  requesterId: string
  addresseeId: string
  createdAt: Date
}

/**
 * ListPendingRequests (AC-F3) — incoming or outgoing pending requests. This is
 * the inbox; its count is the badge (no separate notifications feature).
 */
export class ListPendingRequests {
  constructor(private readonly friendRequests: FriendRequestRepository) {}

  async execute(
    me: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<PendingRequestView[]> {
    const rows = await this.friendRequests.listPending(me, direction)
    return rows.map((r) => ({
      requestId: r.id,
      requesterId: r.requesterId,
      addresseeId: r.addresseeId,
      createdAt: r.createdAt,
    }))
  }
}
