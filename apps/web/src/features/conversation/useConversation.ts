import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getHistory, getReceipts, resolveConversation } from '../../lib/chat/api'
import type { ConversationListItem, ConversationState } from '../../lib/chat/types'
import { useAuth } from '../../lib/auth/auth-context'
import { useDocumentFocus } from '../../lib/useDocumentFocus'
import { useWebSocket } from '../../lib/ws/WebSocketProvider'
import { fromHistory, messagesReducer, type ChatMessage } from './messages'

/** The partner's high-water marks — what my own messages' checkmarks read from. */
export interface ConversationReceipts {
  deliveredUpTo: string | null
  readUpTo: string | null
}

export interface UseConversationResult {
  friend: { id: string; displayName: string } | null
  state: ConversationState
  messages: ChatMessage[]
  receipts: ConversationReceipts
  sendMessage: (body: string) => void
  isLoading: boolean
  isError: boolean
}

/**
 * Drives one conversation thread, addressed by friend: resolves it, loads
 * history, merges live frames + optimistic sends, and runs the receipt loop —
 * emitting my delivered/read marks for the partner's messages, and tracking the
 * partner's marks so my own messages can render sent → delivered → seen.
 */
export function useConversation(friendId: string): UseConversationResult {
  const me = useAuth().user?.id ?? ''
  const { send, subscribe } = useWebSocket()
  const qc = useQueryClient()
  const focused = useDocumentFocus()

  const resolveQuery = useQuery({
    queryKey: ['conversation', friendId],
    queryFn: () => resolveConversation(friendId),
  })
  const conversationId = resolveQuery.data?.conversation?.conversationId ?? null
  const state: ConversationState = resolveQuery.data?.conversation?.state ?? 'open'
  const friend = resolveQuery.data?.friend ?? null

  const historyQuery = useQuery({
    queryKey: ['history', conversationId],
    queryFn: () => getHistory(conversationId!),
    enabled: conversationId !== null,
  })

  const [messages, dispatch] = useReducer(messagesReducer, [])
  const conversationIdRef = useRef<string | null>(conversationId)
  conversationIdRef.current = conversationId

  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [friendId])

  useEffect(() => {
    if (historyQuery.data) {
      dispatch({ type: 'merge', messages: historyQuery.data.messages.map((m) => fromHistory(m, me)) })
    }
  }, [historyQuery.data, me])

  useEffect(() => {
    return subscribe((frame) => {
      if (frame.type === 'message.received') {
        const d = frame.data
        const belongsHere =
          (d.senderId === friendId && d.recipientId === me) ||
          (d.senderId === me && d.recipientId === friendId)
        if (!belongsHere) return
        dispatch({
          type: 'received',
          message: {
            key: d.senderId === me ? d.clientMsgId : d.id,
            id: d.id,
            clientMsgId: d.senderId === me ? d.clientMsgId : undefined,
            senderId: d.senderId,
            body: d.body,
            createdAt: d.createdAt,
            status: 'sent',
            mine: d.senderId === me,
          },
        })
      } else if (frame.type === 'message.sent') {
        dispatch({ type: 'ack', clientMsgId: frame.data.clientMsgId, id: frame.data.id, createdAt: frame.data.createdAt })
        if (conversationIdRef.current === null) {
          qc.invalidateQueries({ queryKey: ['conversation', friendId] })
        }
      } else if (frame.type === 'message.rejected') {
        dispatch({ type: 'rejected', clientMsgId: frame.data.clientMsgId })
      }
    })
  }, [subscribe, friendId, me, qc])

  const sendMessage = useCallback(
    (body: string) => {
      const text = body.trim()
      if (!text) return
      const clientMsgId = crypto.randomUUID()
      dispatch({
        type: 'optimistic',
        message: {
          key: clientMsgId,
          clientMsgId,
          senderId: me,
          body: text,
          createdAt: new Date().toISOString(),
          status: 'sending',
          mine: true,
        },
      })
      const sent = send({ type: 'message.send', clientMsgId, toUserId: friendId, body: text })
      if (!sent) dispatch({ type: 'rejected', clientMsgId })
    },
    [send, friendId, me],
  )

  // ---- receipts -------------------------------------------------------------

  // The partner's marks, for rendering MY messages. Seeded from the resync fetch,
  // kept current by receipt.update frames. (1:1 → any receipt from the friend is
  // for this conversation.)
  const [receipts, setReceipts] = useState<ConversationReceipts>({ deliveredUpTo: null, readUpTo: null })
  useEffect(() => {
    setReceipts({ deliveredUpTo: null, readUpTo: null })
  }, [friendId])

  const receiptsQuery = useQuery({
    queryKey: ['receipts', conversationId],
    queryFn: () => getReceipts(conversationId!),
    enabled: conversationId !== null,
  })
  useEffect(() => {
    const theirs = receiptsQuery.data?.find((p) => p.userId === friendId)
    if (theirs) {
      setReceipts((prev) => ({
        deliveredUpTo: maxId(prev.deliveredUpTo, theirs.deliveredUpTo),
        readUpTo: maxId(prev.readUpTo, theirs.readUpTo),
      }))
    }
  }, [receiptsQuery.data, friendId])

  useEffect(() => {
    return subscribe((frame) => {
      if (frame.type === 'receipt.update' && frame.data.by === friendId) {
        setReceipts((prev) => ({
          deliveredUpTo: maxId(prev.deliveredUpTo, frame.data.deliveredUpTo),
          readUpTo: maxId(prev.readUpTo, frame.data.readUpTo),
        }))
      }
    })
  }, [subscribe, friendId])

  // Emit MY delivered/read for the partner's messages. The high-water mark is the
  // newest message I've received from them; `read` only while the tab is focused
  // (§4.3), and it implies delivered.
  const partnerLatestId = useMemo(() => {
    let max: string | null = null
    for (const m of messages) {
      if (!m.mine && m.id && (!max || m.id > max)) max = m.id
    }
    return max
  }, [messages])

  const emittedDelivered = useRef<string | null>(null)
  const emittedRead = useRef<string | null>(null)
  useEffect(() => {
    emittedDelivered.current = null
    emittedRead.current = null
  }, [conversationId])

  useEffect(() => {
    if (!conversationId || !partnerLatestId) return
    if (focused) {
      if (!emittedRead.current || partnerLatestId > emittedRead.current) {
        emittedRead.current = partnerLatestId
        emittedDelivered.current = partnerLatestId
        send({ type: 'receipt', conversationId, readUpTo: partnerLatestId })
        // Clear the sidebar unread badge immediately, rather than waiting for the
        // next conversations refetch to report the server-recomputed count.
        qc.setQueryData<ConversationListItem[]>(['conversations'], (rows) =>
          rows?.map((c) => (c.conversationId === conversationId ? { ...c, unreadCount: 0 } : c)),
        )
      }
    } else if (!emittedDelivered.current || partnerLatestId > emittedDelivered.current) {
      emittedDelivered.current = partnerLatestId
      send({ type: 'receipt', conversationId, deliveredUpTo: partnerLatestId })
    }
  }, [conversationId, partnerLatestId, focused, send, qc])

  return {
    friend,
    state,
    messages,
    receipts,
    sendMessage,
    isLoading: resolveQuery.isPending || (conversationId !== null && historyQuery.isPending),
    isError: resolveQuery.isError,
  }
}

function maxId(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}
