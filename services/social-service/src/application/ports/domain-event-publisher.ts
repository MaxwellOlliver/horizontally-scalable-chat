import type { DomainEvent } from '../../domain/events.js'

/**
 * Publishes integration events to the bus (spec §2.4a). Called only AFTER the
 * state change is durably committed (AC-E4). Backend services (chat-service)
 * consume these; it is not the path to user pushes.
 */
export interface DomainEventPublisher {
  publish(event: DomainEvent): Promise<void>
}
