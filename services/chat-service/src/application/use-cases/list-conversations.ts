import type { Conversation, ConversationState } from '../../domain/conversation.js'
import type { Message } from '../../domain/message.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { MessageRepository } from '../ports/message-repository.js'
import type { UserDirectory } from '../ports/user-directory.js'

export interface ConversationListItem {
  conversationId: string
  otherUser: { id: string; displayName: string | null }
  state: ConversationState
  lastMessage: { id: string; body: string; senderId: string; createdAt: string } | null
  /** ISO timestamp of the last activity (last message, else conversation creation). */
  lastActivityAt: string
}

/**
 * ListConversations: the conversation-list read for a user. Returns each
 * conversation with the OTHER participant (name resolved from the user
 * directory), its open/closed state, and a last-message preview — ordered by
 * most-recent activity. Conversations with no messages yet are included (a fresh
 * thread sorts by its creation time).
 */
export class ListConversations {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly users: UserDirectory,
  ) {}

  async execute(me: string): Promise<ConversationListItem[]> {
    const conversations = await this.conversations.listForUser(me)
    if (conversations.length === 0) return []

    const lastByConversation = new Map<string, Message>()
    for (const message of await this.messages.latestByConversations(conversations.map((c) => c.id))) {
      lastByConversation.set(message.conversationId, message)
    }

    const otherId = (c: Conversation): string => (c.userA === me ? c.userB : c.userA)
    const profiles = await this.users.listProfiles([...new Set(conversations.map(otherId))])
    const nameById = new Map(profiles.map((p) => [p.id, p.displayName]))

    const items = conversations.map((c): ConversationListItem => {
      const other = otherId(c)
      const last = lastByConversation.get(c.id) ?? null
      return {
        conversationId: c.id,
        otherUser: { id: other, displayName: nameById.get(other) ?? null },
        state: c.state,
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              senderId: last.senderId,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
        lastActivityAt: (last?.createdAt ?? c.createdAt).toISOString(),
      }
    })

    // Most-recent activity first. The sort key is the last message's UUIDv7 (time
    // ordered) or, for an empty thread, the conversation id.
    return items.sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  }
}

function sortKey(item: ConversationListItem): string {
  return item.lastMessage?.id ?? item.conversationId
}
