import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../lib/auth/auth-context'
import { useWebSocket } from '../../lib/ws/WebSocketProvider'
import { useConversations } from '../conversations/useConversations'

/**
 * App-level delivery acks. `delivered` means the recipient's *device* received
 * the message — independent of which conversation is open or whether the tab is
 * focused (REQUIREMENTS §4.2). Two sources, deduped by a per-conversation
 * high-water mark:
 *
 *   - live frames — ack the instant any inbound message arrives, on any thread;
 *   - catch-up — when the conversation list (re)loads (initial open, or after a
 *     reconnect) ack the latest partner message in every thread WITHOUT opening
 *     them, so messages that arrived while offline flip to delivered on return
 *     (REQUIREMENTS §8.3).
 *
 * `seen` stays in useConversation (focus + viewing that thread).
 */
export function useDeliveryReceipts(): void {
  const me = useAuth().user?.id ?? ''
  const { send, subscribe, linkState } = useWebSocket()
  const qc = useQueryClient()
  const { data: conversations } = useConversations()
  const ackedRef = useRef<Map<string, string>>(new Map())

  // Emit a delivered receipt at most once per (conversation, high-water mark).
  // Only record it as acked if the socket actually took the frame, so a failed
  // send (socket not live) is retried when the effects re-run on reconnect.
  const ackDelivered = useCallback(
    (conversationId: string, messageId: string) => {
      const acked = ackedRef.current.get(conversationId)
      if (acked && messageId <= acked) return // UUIDv7 ids sort lexicographically
      if (send({ type: 'receipt', conversationId, deliveredUpTo: messageId })) {
        ackedRef.current.set(conversationId, messageId)
      }
    },
    [send],
  )

  // Live delivery — the instant a frame arrives, regardless of the open thread.
  useEffect(() => {
    return subscribe((frame) => {
      if (frame.type !== 'message.received') return
      const d = frame.data
      if (d.senderId !== me) ackDelivered(d.conversationId, d.id)
    })
  }, [subscribe, me, ackDelivered])

  // Catch-up — ack the last partner message in every listed conversation.
  useEffect(() => {
    if (!conversations) return
    for (const c of conversations) {
      if (c.lastMessage && c.lastMessage.senderId !== me) {
        ackDelivered(c.conversationId, c.lastMessage.id)
      }
    }
  }, [conversations, me, ackDelivered])

  // On reconnect (degraded -> live), refresh the list so offline-gap messages
  // are pulled in and the catch-up effect above can ack them.
  const wasDegraded = useRef(false)
  useEffect(() => {
    if (linkState === 'reconnecting' || linkState === 'offline') {
      wasDegraded.current = true
    } else if (linkState === 'live' && wasDegraded.current) {
      wasDegraded.current = false
      qc.invalidateQueries({ queryKey: ['conversations'] })
    }
  }, [linkState, qc])
}
