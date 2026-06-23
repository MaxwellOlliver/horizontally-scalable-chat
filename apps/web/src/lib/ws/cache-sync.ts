import type { QueryClient } from '@tanstack/react-query'
import type { ServerFrame } from './protocol'

/**
 * Built-in cache invalidation for real-time frames, so the sidebar lists update
 * live without a refresh. Message rendering inside an open thread is handled by
 * the conversation component (which subscribes to frames directly).
 */
export function applyFrameToCache(qc: QueryClient, frame: ServerFrame): void {
  switch (frame.type) {
    case 'friend_request.received':
      qc.invalidateQueries({ queryKey: ['requests', 'incoming'] })
      break
    case 'friend_request.accepted':
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['requests', 'outgoing'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      break
    case 'friendship.removed':
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      break
    case 'message.received':
    case 'message.sent':
      qc.invalidateQueries({ queryKey: ['conversations'] })
      break
  }
}
