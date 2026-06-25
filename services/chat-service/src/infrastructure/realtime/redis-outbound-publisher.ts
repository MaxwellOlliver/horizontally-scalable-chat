import { createRedisPublisher, userChannel } from '@hsc/platform'
import type {
  OutboundFrame,
  OutboundPublisher,
} from '../../application/ports/outbound-publisher.js'

export interface ClosableOutboundPublisher extends OutboundPublisher {
  close(): Promise<void>
}

/**
 * Publishes outbound frames to a user's per-user Redis channel `user:{id}`
 * (spec §2.3) — the same channel the gateway subscribes to for held connections.
 * Offline users have no subscriber, so the frame is dropped and the message is
 * picked up on reconnect via history (AC-D2). Connection management is the
 * shared platform publisher; this only binds the channel convention + frame type.
 */
export function createRedisOutboundPublisher(url: string): ClosableOutboundPublisher {
  const publisher = createRedisPublisher(url)
  return {
    publishToUser: (userId: string, frame: OutboundFrame) =>
      publisher.publish(userChannel(userId), frame),
    close: () => publisher.close(),
  }
}
