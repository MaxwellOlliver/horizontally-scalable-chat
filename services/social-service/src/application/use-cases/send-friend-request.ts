import {
  AddresseeNotFoundError,
  AlreadyFriendsError,
  DuplicateRequestError,
  SelfRequestError,
} from '../../domain/errors.js'
import type { FriendRequest, FriendRequestStatus } from '../../domain/friend-request.js'
import { acceptPending, type AcceptPendingDeps } from '../accept-pending.js'
import { safePublish, safePush } from '../outbound.js'
import type { UserDirectory } from '../ports/user-directory.js'

export interface SendFriendRequestResult {
  requestId: string
  status: FriendRequestStatus
}

export interface SendFriendRequestDeps extends AcceptPendingDeps {
  users: UserDirectory
}

/**
 * SendFriendRequest (AC-S1..S7). Validates the request, and — if the addressee
 * has already sent a pending request the other way — accepts that instead of
 * creating a new one (mutual intent ⇒ friendship, AC-S5).
 */
export class SendFriendRequest {
  constructor(private readonly deps: SendFriendRequestDeps) {}

  async execute(requesterId: string, addresseeId: string): Promise<SendFriendRequestResult> {
    if (requesterId === addresseeId) {
      throw new SelfRequestError() // AC-S2
    }
    if (!(await this.deps.users.exists(addresseeId))) {
      throw new AddresseeNotFoundError() // AC-S6
    }
    if (await this.deps.friendships.areFriends(requesterId, addresseeId)) {
      throw new AlreadyFriendsError() // AC-S3
    }

    // AC-S5 — a pending request the other way means mutual intent: accept it
    // rather than creating a second request.
    const reverse = await this.deps.friendRequests.findPending(addresseeId, requesterId)
    if (reverse) {
      await acceptPending(this.deps, reverse)
      return { requestId: reverse.id, status: 'accepted' }
    }

    // AC-S4 — a pending request already exists this way.
    const existing = await this.deps.friendRequests.findPending(requesterId, addresseeId)
    if (existing) {
      throw new DuplicateRequestError()
    }

    const now = this.deps.clock.now()
    const request: FriendRequest = {
      id: this.deps.ids.next(),
      requesterId,
      addresseeId,
      status: 'pending',
      createdAt: now,
      respondedAt: null,
    }
    // create() also surfaces the partial-unique violation as DuplicateRequestError,
    // closing the check-then-insert race (AC-S4).
    await this.deps.friendRequests.create(request)

    await safePublish(this.deps.events, {
      eventId: this.deps.ids.next(),
      type: 'friend_request.created',
      occurredAt: now.toISOString(),
      requesterId,
      addresseeId,
    })
    await safePush(this.deps.livePush, addresseeId, {
      type: 'friend_request.received',
      data: { requestId: request.id, requesterId },
    })

    return { requestId: request.id, status: 'pending' }
  }
}
