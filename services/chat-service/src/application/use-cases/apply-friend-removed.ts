import { canonicalPair, pairKey } from '../../domain/conversation.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { FriendsReadModel } from '../ports/friends-read-model.js'

/** The `friendship.removed` integration event (social-service §2.4a contract). */
export interface FriendRemovedEvent {
  eventId: string
  userA: string
  userB: string
  occurredAt: string
}

/**
 * ApplyFriendRemoved (T7): folds a `friendship.removed` event into the
 * read-model as `removed` (a soft-delete), last-writer-wins by `eventId`
 * (AC-G1) — the row and its `last_event_id` are kept so a stale re-add can't
 * resurrect it. If applied, close the pair's conversation so subsequent sends
 * are rejected (AC-G2); history is preserved.
 */
export class ApplyFriendRemoved {
  constructor(
    private readonly friends: FriendsReadModel,
    private readonly conversations: ConversationRepository,
  ) {}

  async execute(event: FriendRemovedEvent): Promise<void> {
    const applied = await this.friends.apply(
      pairKey(event.userA, event.userB),
      'removed',
      event.eventId,
      new Date(event.occurredAt),
    )
    if (!applied) return // stale/duplicate (AC-G1)

    const { userA, userB } = canonicalPair(event.userA, event.userB)
    await this.conversations.close(userA, userB)
  }
}
