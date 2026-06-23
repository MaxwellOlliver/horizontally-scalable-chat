export type ConversationState = 'open' | 'closed'

/** A row in the conversation list (GET /chat/conversations). */
export interface ConversationListItem {
  conversationId: string
  otherUser: { id: string; displayName: string | null }
  state: ConversationState
  lastMessage: { id: string; body: string; senderId: string; createdAt: string } | null
  lastActivityAt: string
}

/** GET /chat/conversations/with/:friendId — the friend + their conversation (if any). */
export interface ResolvedConversation {
  friend: { id: string; displayName: string }
  conversation: { conversationId: string; state: ConversationState } | null
}

export interface HistoryMessage {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
}

export interface HistoryPage {
  conversationId: string
  messages: HistoryMessage[]
  nextCursor: string | null
}

/** A participant's delivered/read high-water marks (REQUIREMENTS §4). */
export interface ReceiptPointer {
  userId: string
  deliveredUpTo: string | null
  readUpTo: string | null
}
