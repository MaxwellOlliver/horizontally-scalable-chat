import { NotAddresseeError, RequestNotFoundError } from '../../domain/errors.js'
import { acceptPending, type AcceptPendingDeps } from '../accept-pending.js'

export interface AcceptFriendRequestResult {
  friendshipId: string
  /** The original requester — the counterparty to notify in the activity log. */
  requesterId: string
}

/**
 * AcceptFriendRequest (AC-R1, AC-R3..R5). Reads the request first to return the
 * precise error (404 missing / 403 not-addressee), then runs the shared atomic
 * accept (409 if no longer pending / race-safe friendship creation).
 */
export class AcceptFriendRequest {
  constructor(private readonly deps: AcceptPendingDeps) {}

  async execute(requestId: string, me: string): Promise<AcceptFriendRequestResult> {
    const request = await this.deps.friendRequests.findById(requestId)
    if (!request) {
      throw new RequestNotFoundError()
    }
    if (request.addresseeId !== me) {
      throw new NotAddresseeError() // AC-R3
    }
    const friendship = await acceptPending(this.deps, request)
    return { friendshipId: friendship.id, requesterId: request.requesterId }
  }
}
