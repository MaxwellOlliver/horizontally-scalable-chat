import { FriendshipNotFoundError } from '../../domain/errors.js'
import { safePublish, safePush } from '../outbound.js'
import type { Clock } from '../ports/clock.js'
import type { DomainEventPublisher } from '../ports/domain-event-publisher.js'
import type { FriendshipRepository } from '../ports/friendship-repository.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { LivePush } from '../ports/live-push.js'

export interface RemoveFriendDeps {
  friendships: FriendshipRepository
  events: DomainEventPublisher
  livePush: LivePush
  ids: IdGenerator
  clock: Clock
}

/**
 * RemoveFriend (AC-U1, AC-U2). Either party may remove the friendship. The
 * delete is the atomic single-shot transition: if no row was deleted there was
 * no friendship (404, AC-U2). On success it emits `friendship.removed` and
 * pushes a list-update frame to BOTH users (AC-E4, AC-P4). After removal the
 * pair may re-friend, since only the row — not the request history — is gone
 * (AC-U3).
 */
export class RemoveFriend {
  constructor(private readonly deps: RemoveFriendDeps) {}

  async execute(me: string, otherUserId: string): Promise<void> {
    const removed = await this.deps.friendships.remove(me, otherUserId)
    if (!removed) {
      throw new FriendshipNotFoundError() // AC-U2
    }

    const now = this.deps.clock.now()
    await safePublish(this.deps.events, {
      eventId: this.deps.ids.next(),
      type: 'friendship.removed',
      occurredAt: now.toISOString(),
      userA: removed.userA,
      userB: removed.userB,
      removedBy: me,
    })

    // Push to both parties; each frame names the friend that dropped from *that*
    // recipient's list (AC-P4). Best-effort — offline users reflect it on next load.
    await safePush(this.deps.livePush, removed.userA, {
      type: 'friendship.removed',
      data: { userId: removed.userB, by: me },
    })
    await safePush(this.deps.livePush, removed.userB, {
      type: 'friendship.removed',
      data: { userId: removed.userA, by: me },
    })
  }
}
