import { createRedisPublisher, userChannel } from '@hsc/platform'
import type { LiveFrame, LivePush } from '../../application/ports/live-push.js'

export interface ClosableLivePush extends LivePush {
  close(): Promise<void>
}

/**
 * Publishes real-time frames to a user's per-user Redis channel `user:{id}`
 * (spec §2.4b) — the same channel the gateway subscribes to for held users.
 * Offline users have no subscriber, so the frame is dropped and the change is
 * picked up on the next list load (AC-P5). Connection management is the shared
 * platform publisher; this only binds the channel convention + frame type.
 */
export function createRedisLivePush(url: string): ClosableLivePush {
  const publisher = createRedisPublisher(url)
  return {
    pushToUser: (userId: string, frame: LiveFrame) => publisher.publish(userChannel(userId), frame),
    close: () => publisher.close(),
  }
}
