import { useEffect, useState } from 'react'
import { useWebSocket } from '../../lib/ws/WebSocketProvider'
import type { PresenceStatus } from '../../lib/ws/protocol'

/**
 * Watches a single friend's presence — the one in the open conversation. Tells
 * the gateway to watch them (`presence.subscribe`) whenever the socket is live
 * (so it re-subscribes after a reconnect), and clears the watch on unmount /
 * friend change. The gateway pushes the current status immediately on subscribe.
 */
export function usePresence(friendId: string): PresenceStatus {
  const { send, subscribe, linkState } = useWebSocket()
  const [status, setStatus] = useState<PresenceStatus>('offline')

  useEffect(() => {
    if (linkState !== 'live') return
    send({ type: 'presence.subscribe', userIds: [friendId] })
    return () => {
      send({ type: 'presence.subscribe', userIds: [] })
    }
  }, [friendId, linkState, send])

  useEffect(() => {
    return subscribe((frame) => {
      if (frame.type === 'presence.changed' && frame.data.userId === friendId) {
        setStatus(frame.data.status)
      }
    })
  }, [friendId, subscribe])

  return status
}
