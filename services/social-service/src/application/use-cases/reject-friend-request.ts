import {
  NotAddresseeError,
  RequestNotFoundError,
  RequestNotPendingError,
} from '../../domain/errors.js'
import type { Clock } from '../ports/clock.js'
import type { FriendRequestRepository } from '../ports/friend-request-repository.js'

/**
 * RejectFriendRequest (AC-R2, AC-R3, AC-R4). Atomic transition to `rejected`;
 * no friendship, no event (AC-E3), no push (AC-P3).
 */
export class RejectFriendRequest {
  constructor(
    private readonly friendRequests: FriendRequestRepository,
    private readonly clock: Clock,
  ) {}

  async execute(requestId: string, me: string): Promise<void> {
    const request = await this.friendRequests.findById(requestId)
    if (!request) {
      throw new RequestNotFoundError()
    }
    if (request.addresseeId !== me) {
      throw new NotAddresseeError() // AC-R3
    }
    const updated = await this.friendRequests.transition(requestId, me, 'rejected', this.clock.now())
    if (!updated) {
      throw new RequestNotPendingError() // AC-R4
    }
  }
}
