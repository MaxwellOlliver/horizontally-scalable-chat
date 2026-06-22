import {
  createJwtAccessTokenVerifier,
  createRabbitMqTopicConsumer,
  createRabbitMqWorkQueueConsumer,
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
import { ApplyFriendAccepted } from './application/use-cases/apply-friend-accepted.js'
import { ApplyFriendRemoved } from './application/use-cases/apply-friend-removed.js'
import { GetHistory } from './application/use-cases/get-history.js'
import { SendMessage } from './application/use-cases/send-message.js'
import { createDatabase, type Database } from './infrastructure/db/client.js'
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
  ids: IdGenerator
  clock: Clock
}

/** The full use-case surface — HTTP (`getHistory`) plus the queue-driven workers. */
export interface ChatApplication extends ChatUseCases {
  sendMessage: SendMessage
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

  const useCases = assembleUseCases({
    messages: createDrizzleMessageRepository(db),
    conversations: createDrizzleConversationRepository(db),
    friends: createDrizzleFriendsReadModel(db),
    outbound,
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

  const inboundHandler = createInboundHandler({ sendMessage: useCases.sendMessage, outbound })
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
        db.close(),
      ])
    },
  }
}
