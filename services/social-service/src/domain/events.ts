/**
 * Integration events (spec §2.4a) emitted to the RabbitMQ topic exchange after
 * a state change commits. Each carries an `eventId` (UUIDv7) so consumers can
 * dedupe; because per-pair transitions are serialized, the `eventId` doubles as
 * a monotonic per-pair ordering marker for last-writer-wins (AC-E5). This shape
 * is a cross-service contract (§2.5).
 */
export type DomainEventType =
  | 'friend_request.created'
  | 'friend_request.accepted'
  | 'friendship.removed'

interface EventMeta {
  eventId: string
  type: DomainEventType
  occurredAt: string // ISO-8601
}

interface DirectedEvent extends EventMeta {
  requesterId: string
  addresseeId: string
}

/** AC-E1 — emitted on send (a new pending request). */
export interface FriendRequestCreatedEvent extends DirectedEvent {
  type: 'friend_request.created'
}

/** AC-E2 — emitted on accept (friendship formed). */
export interface FriendRequestAcceptedEvent extends DirectedEvent {
  type: 'friend_request.accepted'
}

/**
 * AC-E4 — emitted on un-friend. Carries the canonical pair plus who removed it
 * (chat-service binds this to close conversation state / drop its read-model).
 */
export interface FriendshipRemovedEvent extends EventMeta {
  type: 'friendship.removed'
  userA: string
  userB: string
  removedBy: string
}

export type DomainEvent =
  | FriendRequestCreatedEvent
  | FriendRequestAcceptedEvent
  | FriendshipRemovedEvent
