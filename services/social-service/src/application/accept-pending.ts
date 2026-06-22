import { RequestNotPendingError } from '../domain/errors.js'
import type { FriendRequest } from '../domain/friend-request.js'
import { canonicalPair, type Friendship } from '../domain/friendship.js'
import type { Clock } from './ports/clock.js'
import type { DomainEventPublisher } from './ports/domain-event-publisher.js'
import type { FriendRequestRepository } from './ports/friend-request-repository.js'
import type { FriendshipRepository } from './ports/friendship-repository.js'
import type { IdGenerator } from './ports/id-generator.js'
import type { LivePush } from './ports/live-push.js'
import { safePublish, safePush } from './outbound.js'

export interface AcceptPendingDeps {
  friendRequests: FriendRequestRepository
  friendships: FriendshipRepository
  events: DomainEventPublisher
  livePush: LivePush
  ids: IdGenerator
  clock: Clock
}

/**
 * Shared accept path used by both AcceptFriendRequest and SendFriendRequest's
 * reverse auto-accept (AC-S5). The caller MUST have already established that the
 * request exists and that `request.addresseeId` is the authenticated user.
 *
 * Atomic transition + idempotent friendship insert make concurrent accepts safe
 * (AC-R5): exactly one transition wins; the loser gets RequestNotPendingError.
 * On success it emits the integration event and pushes the live frame to the
 * original requester (AC-E2, AC-P2).
 */
export async function acceptPending(
  deps: AcceptPendingDeps,
  request: FriendRequest,
): Promise<Friendship> {
  const now = deps.clock.now()

  const updated = await deps.friendRequests.transition(
    request.id,
    request.addresseeId,
    'accepted',
    now,
  )
  if (!updated) {
    // Not pending anymore, or a concurrent accept already won.
    throw new RequestNotPendingError()
  }

  const { userA, userB } = canonicalPair(request.requesterId, request.addresseeId)
  const friendship = await deps.friendships.ensure(deps.ids.next(), userA, userB, now)

  await safePublish(deps.events, {
    eventId: deps.ids.next(),
    type: 'friend_request.accepted',
    occurredAt: now.toISOString(),
    requesterId: request.requesterId,
    addresseeId: request.addresseeId,
  })
  await safePush(deps.livePush, request.requesterId, {
    type: 'friend_request.accepted',
    data: { friendshipId: friendship.id, by: request.addresseeId },
  })

  return friendship
}
