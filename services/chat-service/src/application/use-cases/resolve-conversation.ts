import { canonicalPair, type ConversationState } from '../../domain/conversation.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { UserDirectory } from '../ports/user-directory.js'

export interface ResolvedConversation {
  friend: { id: string; displayName: string }
  /** null when no conversation exists yet — a fresh thread, created on first send. */
  conversation: { conversationId: string; state: ConversationState } | null
}

/**
 * ResolveConversation: given a friend's id, returns their profile plus the
 * existing conversation (if any). This is what lets the client open a thread by
 * *friend* — the same view serves an existing conversation and a brand-new one
 * (null conversation), which the first message lazily creates. Returns null when
 * the friend id is not a real user (→ 404).
 */
export class ResolveConversation {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly users: UserDirectory,
  ) {}

  async execute(me: string, friendId: string): Promise<ResolvedConversation | null> {
    const [friend] = await this.users.listProfiles([friendId])
    if (!friend) return null

    const { userA, userB } = canonicalPair(me, friendId)
    const conversation = await this.conversations.findByPair(userA, userB)

    return {
      friend,
      conversation: conversation
        ? { conversationId: conversation.id, state: conversation.state }
        : null,
    }
  }
}
