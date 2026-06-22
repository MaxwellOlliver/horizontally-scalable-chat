import type { FriendRequest, FriendRequestStatus } from '../../domain/friend-request.js'

export interface FriendRequestRepository {
  /**
   * Inserts a new pending request. Implementations MUST surface the
   * partial-unique (pending) violation as DuplicateRequestError so a send race
   * resolves to 409 (AC-S4), not a 500.
   */
  create(request: FriendRequest): Promise<void>

  findById(id: string): Promise<FriendRequest | null>

  /** The pending request from requester -> addressee, if any (dup / reverse checks). */
  findPending(requesterId: string, addresseeId: string): Promise<FriendRequest | null>

  /**
   * Atomic single-shot transition (AC-R4/R5):
   * UPDATE ... SET status=:to, responded_at=:at
   * WHERE id=:id AND addressee_id=:addresseeId AND status='pending'.
   * Returns the updated request, or null when no row matched (already
   * responded, or lost a concurrent race).
   */
  transition(
    id: string,
    addresseeId: string,
    to: Extract<FriendRequestStatus, 'accepted' | 'rejected'>,
    at: Date,
  ): Promise<FriendRequest | null>

  /** Pending requests in a direction, for the lists (AC-F3). */
  listPending(userId: string, direction: 'incoming' | 'outgoing'): Promise<FriendRequest[]>
}
