/**
 * FriendRequest (spec §2.2). A single-shot state machine:
 * pending -> accepted | rejected. The actual transition is performed as an
 * atomic conditional UPDATE in the repository (AC-R4/R5); this entity models
 * the shape and the guard.
 */
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected'

export interface FriendRequest {
  readonly id: string
  readonly requesterId: string
  readonly addresseeId: string
  readonly status: FriendRequestStatus
  readonly createdAt: Date
  readonly respondedAt: Date | null
}

export function isPending(request: FriendRequest): boolean {
  return request.status === 'pending'
}
