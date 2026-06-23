import { ConversationNotFoundError, NotParticipantError } from '../../domain/errors.js'
import { isParticipant } from '../../domain/conversation.js'
import type { Message } from '../../domain/message.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { MessageRepository } from '../ports/message-repository.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export interface GetHistoryInput {
  me: string
  conversationId: string
  /** Exclusive cursor: return messages older than this UUIDv7 (AC-H1). */
  before?: string
  limit?: number
}

export interface HistoryMessage {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
}

export interface GetHistoryResult {
  conversationId: string
  messages: HistoryMessage[]
  /** Cursor to fetch the next (older) page, or null when the end is reached. */
  nextCursor: string | null
}

/**
 * GetHistory (T8): loads a conversation's messages most-recent-first, paginated
 * by a UUIDv7 cursor (AC-H1/H2). Authorizes that the caller is a participant
 * (AC-H3) — a non-participant gets 403, an unknown conversation 404.
 */
export class GetHistory {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async execute(input: GetHistoryInput): Promise<GetHistoryResult> {
    const conversation = await this.conversations.findById(input.conversationId)
    if (!conversation) throw new ConversationNotFoundError()
    if (!isParticipant(conversation, input.me)) throw new NotParticipantError()

    const limit = clampLimit(input.limit)
    const rows = await this.messages.page(conversation.id, { limit, before: input.before })

    // A full page implies there may be more; the oldest id is the next cursor.
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null

    return {
      conversationId: conversation.id,
      messages: rows.map(toDto),
      nextCursor,
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
}

function toDto(message: Message): HistoryMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  }
}
