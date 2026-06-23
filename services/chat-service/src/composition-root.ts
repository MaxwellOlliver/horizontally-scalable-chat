import {
  createJwtAccessTokenVerifier,
  createLogger,
  createRabbitMqTopicConsumer,
  createRabbitMqWorkQueueConsumer,
  createRedisPublisher,
  resolveInstanceId,
  systemClock,
  uuidv7Generator,
  type AccessTokenVerifier,
  type Clock,
  type IdGenerator,
  type RabbitMqConsumer,
} from '@hsc/platform'
import type { Env } from './config/env.js'
import type { ConversationRepository } from './application/ports/conversation-repository.js'
import type { FriendsReadModel } from './application/ports/friends-read-model.js'
import type { MessageRepository } from './application/ports/message-repository.js'
import type { OutboundPublisher } from './application/ports/outbound-publisher.js'
import type { ReceiptRepository } from './application/ports/receipt-repository.js'
import type { UserDirectory } from './application/ports/user-directory.js'
import { ApplyFriendAccepted } from './application/use-cases/apply-friend-accepted.js'
import { ApplyFriendRemoved } from './application/use-cases/apply-friend-removed.js'
import { GetHistory } from './application/use-cases/get-history.js'
import { GetReceipts } from './application/use-cases/get-receipts.js'
import { ListConversations } from './application/use-cases/list-conversations.js'
import { RecordReceipt } from './application/use-cases/record-receipt.js'
import { ResolveConversation } from './application/use-cases/resolve-conversation.js'
import { SendMessage } from './application/use-cases/send-message.js'
import { createDatabase, type Database } from './infrastructure/db/client.js'
import { createDrizzleUserDirectory } from './infrastructure/directory/drizzle-user-directory.js'
import { createDrizzleReceiptRepository } from './infrastructure/repositories/drizzle-receipt-repository.js'
import {
  createRedisOutboundPublisher,
  type ClosableOutboundPublisher,
} from './infrastructure/realtime/redis-outbound-publisher.js'
import { createDrizzleConversationRepository } from './infrastructure/repositories/drizzle-conversation-repository.js'
import { createDrizzleFriendsReadModel } from './infrastructure/repositories/drizzle-friends-read-model.js'
import { createDrizzleMessageRepository } from './infrastructure/repositories/drizzle-message-repository.js'
import { createFriendEventHandler } from './interface/queue/friend-event-handler.js'
import { createInboundHandler } from './interface/queue/inbound-handler.js'
import type { ChatUseCases } from './interface/http/routes/chat.js'

/** Everything the use-case layer depends on, as ports (clean-arch boundary). */
export interface ChatPorts {
  messages: MessageRepository
  conversations: ConversationRepository
  friends: FriendsReadModel
  outbound: OutboundPublisher
  users: UserDirectory
  receipts: ReceiptRepository
  ids: IdGenerator
  clock: Clock
}

/** The full use-case surface — HTTP (`getHistory`) plus the queue-driven workers. */
export interface ChatApplication extends ChatUseCases {
  sendMessage: SendMessage
  recordReceipt: RecordReceipt
  applyFriendAccepted: ApplyFriendAccepted
  applyFriendRemoved: ApplyFriendRemoved
}

/**
 * Pure assembly of the use cases from ports. Production and tests both call this
 * — production passes Drizzle/RabbitMQ/Redis adapters, tests pass in-memory
 * fakes — so the wiring under test is the real wiring.
 */
export function assembleUseCases(ports: ChatPorts): ChatApplication {
  return {
    sendMessage: new SendMessage({
      messages: ports.messages,
      conversations: ports.conversations,
      friends: ports.friends,
      outbound: ports.outbound,
      ids: ports.ids,
      clock: ports.clock,
    }),
    getHistory: new GetHistory(ports.conversations, ports.messages),
    listConversations: new ListConversations(ports.conversations, ports.messages, ports.users),
    resolveConversation: new ResolveConversation(ports.conversations, ports.users),
    getReceipts: new GetReceipts(ports.conversations, ports.receipts),
    recordReceipt: new RecordReceipt(ports.conversations, ports.receipts, ports.outbound, ports.clock),
    applyFriendAccepted: new ApplyFriendAccepted(ports.friends, ports.conversations),
    applyFriendRemoved: new ApplyFriendRemoved(ports.friends, ports.conversations),
  }
}

export interface Container {
  useCases: ChatApplication
  verifier: AccessTokenVerifier
  db: Database
  /** Asserts queue topology and begins consuming the inbound + friend-event queues. */
  startConsumers(): Promise<void>
  close(): Promise<void>
}

/** Production container: real adapters wired from validated env. */
export function createContainer(env: Env): Container {
  const db = createDatabase(env.DATABASE_URL)
  const outbound: ClosableOutboundPublisher = createRedisOutboundPublisher(env.REDIS_URL)

  // Observability log stream — tags work with this instance's id and ships it to
  // the affected users over the same Redis → gateway path as domain frames.
  const logPublisher = createRedisPublisher(env.REDIS_URL)
  const logger = createLogger({
    instanceId: resolveInstanceId('chat-service'),
    source: 'chat-service',
    publish: (channel, message) => logPublisher.publish(channel, message),
  })

  const useCases = assembleUseCases({
    messages: createDrizzleMessageRepository(db),
    conversations: createDrizzleConversationRepository(db),
    friends: createDrizzleFriendsReadModel(db),
    outbound,
    users: createDrizzleUserDirectory(db),
    receipts: createDrizzleReceiptRepository(db),
    ids: uuidv7Generator,
    clock: systemClock,
  })

  // Inbound client messages — a competing-consumer work queue (spec non-functional).
  const inboundConsumer: RabbitMqConsumer = createRabbitMqWorkQueueConsumer({
    url: env.RABBITMQ_URL,
    queue: env.INBOUND_QUEUE,
  })
  // Friend events — a durable queue bound to the `domain.events` topic exchange.
  const friendEventsConsumer: RabbitMqConsumer = createRabbitMqTopicConsumer({
    url: env.RABBITMQ_URL,
    exchange: env.DOMAIN_EVENTS_EXCHANGE,
    queue: env.FRIEND_EVENTS_QUEUE,
    patterns: ['friend_request.accepted', 'friendship.removed'],
  })

  const inboundHandler = createInboundHandler({
    sendMessage: useCases.sendMessage,
    recordReceipt: useCases.recordReceipt,
    outbound,
    logger,
  })
  const friendEventHandler = createFriendEventHandler({
    applyFriendAccepted: useCases.applyFriendAccepted,
    applyFriendRemoved: useCases.applyFriendRemoved,
  })

  return {
    useCases,
    verifier: createJwtAccessTokenVerifier(env.JWT_SECRET, env.JWT_ISSUER),
    db,
    startConsumers: async () => {
      await inboundConsumer.start((d) => inboundHandler(d.body))
      await friendEventsConsumer.start((d) => friendEventHandler(d.body))
    },
    close: async () => {
      await Promise.allSettled([
        inboundConsumer.close(),
        friendEventsConsumer.close(),
        outbound.close(),
        logPublisher.close(),
        db.close(),
      ])
    },
  }
}
