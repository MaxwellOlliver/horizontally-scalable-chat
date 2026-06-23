import { canonicalPair, type Conversation } from '../../domain/conversation.js'
import {
  ConversationClosedError,
  EmptyMessageError,
  MessageTooLongError,
  NotFriendsError,
} from '../../domain/errors.js'
import { isBlank, isTooLong, type Message } from '../../domain/message.js'
import type { Clock } from '../ports/clock.js'
import type { ConversationRepository } from '../ports/conversation-repository.js'
import type { FriendsReadModel } from '../ports/friends-read-model.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { MessageRepository } from '../ports/message-repository.js'
import type { OutboundPublisher } from '../ports/outbound-publisher.js'
import { safePublish } from '../outbound.js'

export interface SendMessageInput {
  /** Client-generated optimistic/idempotency key (AC-M3/M4). */
  clientMsgId: string
  /** Authenticated sender, stamped by the gateway (spec §2.2). */
  senderId: string
  /** Friend the message is addressed to. */
  toUserId: string
  body: string
}

export interface SendMessageResult {
  id: string
  conversationId: string
  senderId: string
  recipientId: string
  clientMsgId: string
  body: string
  createdAt: Date
  /** True when an idempotent retry returned the original row (AC-M4). */
  deduped: boolean
}

export interface SendMessageDeps {
  messages: MessageRepository
  conversations: ConversationRepository
  friends: FriendsReadModel
  outbound: OutboundPublisher
  ids: IdGenerator
  clock: Clock
}

/**
 * SendMessage (T4): the inbound work-queue worker's core. Validates the body
 * (AC-M5), runs the friendship gate (AC-M2 — active friends for a NEW
 * conversation; `open` state for an EXISTING one), lazily get-or-creates the
 * conversation, persists with a server UUIDv7 idempotent on `clientMsgId`
 * (AC-M1/M4/O1), then publishes the outbound frames (T5): the message to the
 * recipient (AC-D1), a `sent` ack to the sender (AC-M1), and an echo to the
 * sender's other devices (AC-D3).
 */
export class SendMessage {
  constructor(private readonly deps: SendMessageDeps) {}

  async execute(input: SendMessageInput): Promise<SendMessageResult> {
    const { senderId, toUserId, clientMsgId } = input
    const body = input.body

    if (isBlank(body)) throw new EmptyMessageError() // AC-M5
    if (isTooLong(body)) throw new MessageTooLongError() // AC-M5

    const { userA, userB } = canonicalPair(senderId, toUserId)
    const conversation = await this.resolveConversation(senderId, toUserId, userA, userB)

    const now = this.deps.clock.now()
    const { message, created } = await this.deps.messages.insert({
      id: this.deps.ids.next(),
      conversationId: conversation.id,
      senderId,
      clientMsgId,
      body,
      createdAt: now,
    })

    // Re-publish on a retry too: the original ack may have been the lost frame
    // that triggered the retry. Clients dedupe by id/clientMsgId (AC-M4).
    await this.publishOutbound(message, toUserId)

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      recipientId: toUserId,
      clientMsgId: message.clientMsgId,
      body: message.body,
      createdAt: message.createdAt,
      deduped: !created,
    }
  }

  /**
   * The gate (AC-M2, spec §2.6): a NEW conversation requires active friendship
   * (checked against the read-model); an EXISTING one only requires `open`
   * state — a fast local check with no cross-service call on the hot path.
   */
  private async resolveConversation(
    senderId: string,
    toUserId: string,
    userA: string,
    userB: string,
  ): Promise<Conversation> {
    const existing = await this.deps.conversations.findByPair(userA, userB)
    if (existing) {
      if (existing.state !== 'open') throw new ConversationClosedError() // AC-M2/G2
      return existing
    }
    if (!(await this.deps.friends.isActive(senderId, toUserId))) {
      throw new NotFriendsError() // AC-M2
    }
    return this.deps.conversations.create(this.deps.ids.next(), userA, userB, this.deps.clock.now())
  }

  /** Fan-out (T5). Best-effort; clients dedupe by id/clientMsgId (AC-D1/D3, AC-M1). */
  private async publishOutbound(message: Message, recipientId: string): Promise<void> {
    const received = {
      type: 'message.received' as const,
      data: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        recipientId,
        clientMsgId: message.clientMsgId,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      },
    }
    // To the recipient's devices (AC-D1).
    await safePublish(this.deps.outbound, recipientId, received)
    // The sender's ack: reconcile temp id -> canonical id (AC-M1/M3).
    await safePublish(this.deps.outbound, message.senderId, {
      type: 'message.sent',
      data: {
        clientMsgId: message.clientMsgId,
        id: message.id,
        conversationId: message.conversationId,
        createdAt: message.createdAt.toISOString(),
      },
    })
    // Echo to the sender's OTHER devices; the originating one dedupes (AC-D3).
    await safePublish(this.deps.outbound, message.senderId, received)
  }
}
