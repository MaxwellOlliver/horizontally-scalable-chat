import { canonicalPair, pairKey } from '../../domain/conversation.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { FriendsReadModel } from '../ports/friends-read-model.js'

/** The `friend_request.accepted` integration event (social-service §2.4a contract). */
export interface FriendAcceptedEvent {
  eventId: string
  requesterId: string
  addresseeId: string
  occurredAt: string
}

/**
 * ApplyFriendAccepted (T7): folds a `friend_request.accepted` event into the
 * read-model as `active`, last-writer-wins by `eventId` (AC-G1). If the event
 * actually applied (was newer), reopen a previously-closed conversation so a
 * re-friend resumes the same thread with history preserved (AC-G3).
 */
export class ApplyFriendAccepted {
  constructor(
    private readonly friends: FriendsReadModel,
    private readonly conversations: ConversationRepository,
  ) {}

  async execute(event: FriendAcceptedEvent): Promise<void> {
    const applied = await this.friends.apply(
      pairKey(event.requesterId, event.addresseeId),
      'active',
      event.eventId,
      new Date(event.occurredAt),
    )
    if (!applied) return // stale/duplicate (AC-G1) — don't touch conversation state

    const { userA, userB } = canonicalPair(event.requesterId, event.addresseeId)
    await this.conversations.reopen(userA, userB)
  }
}
