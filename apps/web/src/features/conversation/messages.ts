import type { HistoryMessage } from '../../lib/chat/types'

export type SendStatus = 'sending' | 'sent' | 'failed'

/**
 * A message as the thread renders it. `id` is the canonical UUIDv7 once known;
 * own messages also carry `clientMsgId` so an optimistic bubble reconciles to its
 * server identity on the `sent` ack. `key` is a stable React key that survives
 * that reconciliation (it stays the clientMsgId for own messages).
 */
export interface ChatMessage {
  key: string
  id?: string
  clientMsgId?: string
  senderId: string
  body: string
  createdAt: string
  status: SendStatus
  mine: boolean
}

export type MessagesAction =
  | { type: 'reset' }
  | { type: 'merge'; messages: ChatMessage[] }
  | { type: 'optimistic'; message: ChatMessage }
  | { type: 'received'; message: ChatMessage }
  | { type: 'ack'; clientMsgId: string; id: string; createdAt: string }
  | { type: 'rejected'; clientMsgId: string }

export function messagesReducer(state: ChatMessage[], action: MessagesAction): ChatMessage[] {
  switch (action.type) {
    case 'reset':
      return []
    case 'merge':
      return sort(action.messages.reduce(upsert, state))
    case 'optimistic':
    case 'received':
      return sort(upsert(state, action.message))
    case 'ack':
      return patchByClientMsgId(state, action.clientMsgId, (m) => ({
        ...m,
        id: action.id,
        createdAt: action.createdAt,
        status: 'sent',
      }))
    case 'rejected':
      return patchByClientMsgId(state, action.clientMsgId, (m) => ({ ...m, status: 'failed' }))
  }
}

/** Insert or update — matched by clientMsgId (own) or canonical id (dedupe). */
function upsert(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = list.findIndex(
    (m) =>
      (incoming.clientMsgId !== undefined && m.clientMsgId === incoming.clientMsgId) ||
      (incoming.id !== undefined && m.id === incoming.id),
  )
  if (index === -1) return [...list, incoming]
  const next = [...list]
  next[index] = { ...next[index]!, ...incoming, key: next[index]!.key } // keep the stable key
  return next
}

function patchByClientMsgId(
  list: ChatMessage[],
  clientMsgId: string,
  patch: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const index = list.findIndex((m) => m.clientMsgId === clientMsgId)
  if (index === -1) return list
  const next = [...list]
  next[index] = patch(next[index]!)
  return sort(next)
}

function sort(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt)
    return byTime !== 0 ? byTime : (a.id ?? '').localeCompare(b.id ?? '')
  })
}

export function fromHistory(message: HistoryMessage, me: string): ChatMessage {
  return {
    key: message.id,
    id: message.id,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt,
    status: 'sent',
    mine: message.senderId === me,
  }
}
