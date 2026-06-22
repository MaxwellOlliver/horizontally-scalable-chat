import { createRabbitMqTopicPublisher, type RabbitMqTopicConfig } from '@hsc/platform'
import type { DomainEvent } from '../../domain/events.js'
import type { DomainEventPublisher } from '../../application/ports/domain-event-publisher.js'

export type RabbitMqConfig = RabbitMqTopicConfig

export interface ClosableDomainEventPublisher extends DomainEventPublisher {
  close(): Promise<void>
}

/**
 * Publishes integration events to the RabbitMQ topic exchange (spec §2.4a) via
 * the shared platform publisher. The routing key is the event type
 * (`friend_request.created` / `.accepted` / `friendship.removed`), so consumers
 * bind patterns like `friend_request.*`. The `eventId` is carried as the message
 * id for consumer-side dedupe / per-pair ordering (AC-E5).
 */
export function createRabbitMqDomainEventPublisher(
  config: RabbitMqConfig,
): ClosableDomainEventPublisher {
  const publisher = createRabbitMqTopicPublisher(config)
  return {
    publish: (event: DomainEvent) =>
      publisher.publish(event.type, event, { messageId: event.eventId }),
    close: () => publisher.close(),
  }
}
