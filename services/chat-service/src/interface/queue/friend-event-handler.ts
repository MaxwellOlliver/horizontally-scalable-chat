import { z } from 'zod'
import type { ApplyFriendAccepted } from '../../application/use-cases/apply-friend-accepted.js'
import type { ApplyFriendRemoved } from '../../application/use-cases/apply-friend-removed.js'

/** `friend_request.accepted` (social-service §2.4a cross-service contract). */
const acceptedSchema = z.object({
  type: z.literal('friend_request.accepted'),
  eventId: z.string().uuid(),
  occurredAt: z.string(),
  requesterId: z.string().uuid(),
  addresseeId: z.string().uuid(),
})

/** `friendship.removed` (social-service §2.4a). `userA`/`userB` are canonical. */
const removedSchema = z.object({
  type: z.literal('friendship.removed'),
  eventId: z.string().uuid(),
  occurredAt: z.string(),
  userA: z.string().uuid(),
  userB: z.string().uuid(),
  removedBy: z.string().uuid().optional(),
})

export interface FriendEventHandlerDeps {
  applyFriendAccepted: ApplyFriendAccepted
  applyFriendRemoved: ApplyFriendRemoved
}

/**
 * Builds the `domain.events` handler (T7 wiring): routes by event type into the
 * read-model projections. Unknown/malformed events are dropped (acked) — the
 * queue is only bound to the two patterns we care about, so anything else is a
 * mis-binding, not a transient failure.
 */
export function createFriendEventHandler(deps: FriendEventHandlerDeps) {
  return async (raw: unknown): Promise<void> => {
    const type = (raw as { type?: unknown } | null)?.type
    if (type === 'friend_request.accepted') {
      const event = acceptedSchema.parse(raw)
      await deps.applyFriendAccepted.execute(event)
    } else if (type === 'friendship.removed') {
      const event = removedSchema.parse(raw)
      await deps.applyFriendRemoved.execute(event)
    } else {
      console.error('[chat] ignoring unexpected domain event', { type })
    }
  }
}
