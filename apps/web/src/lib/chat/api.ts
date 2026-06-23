import { api } from '../api'
import type {
  ConversationListItem,
  HistoryPage,
  ReceiptPointer,
  ResolvedConversation,
} from './types'

/** The authenticated user's conversations, most-recent-activity first. */
export async function listConversations(): Promise<ConversationListItem[]> {
  const { data } = await api.get<{ conversations: ConversationListItem[] }>('/chat/conversations')
  return data.conversations
}

/** Resolve a friend → their profile + the existing conversation (or null). */
export async function resolveConversation(friendId: string): Promise<ResolvedConversation> {
  const { data } = await api.get<ResolvedConversation>(`/chat/conversations/with/${friendId}`)
  return data
}

/** A page of a conversation's history, most-recent-first (UUIDv7 cursor). */
export async function getHistory(conversationId: string, before?: string): Promise<HistoryPage> {
  const { data } = await api.get<HistoryPage>(`/chat/conversations/${conversationId}/messages`, {
    params: before ? { before } : undefined,
  })
  return data
}

/** Both participants' receipt pointers for a conversation (resync, §8.3). */
export async function getReceipts(conversationId: string): Promise<ReceiptPointer[]> {
  const { data } = await api.get<{ receipts: ReceiptPointer[] }>(
    `/chat/conversations/${conversationId}/receipts`,
  )
  return data.receipts
}
