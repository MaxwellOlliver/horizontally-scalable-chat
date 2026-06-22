import { connect, type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib'

export interface RabbitMqTopicConfig {
  url: string
  exchange: string
}

export interface TopicPublishOptions {
  /** Carried as the AMQP message id (e.g. an event id for consumer dedupe). */
  messageId?: string
}

/**
 * Publishes JSON messages to a durable RabbitMQ topic exchange, keyed by a
 * routing key so consumers bind with patterns (e.g. `friend_request.*`).
 * The connection/channel is established lazily and reused. Messages are
 * persistent. Shared by every service that emits to the `domain.events` bus.
 */
export interface TopicPublisher {
  publish(routingKey: string, message: unknown, opts?: TopicPublishOptions): Promise<void>
  close(): Promise<void>
}

export function createRabbitMqTopicPublisher(config: RabbitMqTopicConfig): TopicPublisher {
  let setup: Promise<{ conn: ChannelModel; channel: Channel }> | null = null

  async function channel(): Promise<Channel> {
    setup ??= (async () => {
      const conn = await connect(config.url)
      const channel = await conn.createChannel()
      await channel.assertExchange(config.exchange, 'topic', { durable: true })
      return { conn, channel }
    })()
    return (await setup).channel
  }

  return {
    async publish(routingKey: string, message: unknown, opts?: TopicPublishOptions): Promise<void> {
      const ch = await channel()
      ch.publish(config.exchange, routingKey, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: 'application/json',
        messageId: opts?.messageId,
        timestamp: Date.now(),
      })
    },
    async close(): Promise<void> {
      if (setup) {
        const { conn } = await setup
        await conn.close()
      }
    },
  }
}

/** A single delivery handed to a consumer handler (body already JSON-decoded). */
export interface RabbitMqDelivery {
  /** The JSON-decoded message body. */
  body: unknown
  /** The publisher-supplied message id (e.g. an event id), if any. */
  messageId?: string
  /** The routing key the message arrived on (the event type for topic consumers). */
  routingKey: string
}

/**
 * Processes one delivery. Returning normally acks the message; throwing nacks it
 * WITHOUT requeue (the broker drops/dead-letters it) so a poison message can't
 * spin forever. Callers that want a domain rejection to be acked must catch it
 * inside the handler and return normally.
 */
export type RabbitMqHandler = (delivery: RabbitMqDelivery) => Promise<void>

/** A started consumer that can be torn down on shutdown. */
export interface RabbitMqConsumer {
  /** Asserts topology and begins consuming. Idempotent: a second call is a no-op. */
  start(handler: RabbitMqHandler): Promise<void>
  close(): Promise<void>
}

export interface RabbitMqWorkQueueConfig {
  url: string
  /** The durable work queue all competing consumers read from. */
  queue: string
  /** Unacked-message window per consumer (competing-consumer fairness). Default 10. */
  prefetch?: number
}

/**
 * A durable **work queue** consumer (competing consumers): every worker reads the
 * same queue and the broker hands each message to exactly one. Used by
 * chat-service for the inbound client-message queue (messaging spec §2.1, T3).
 */
export function createRabbitMqWorkQueueConsumer(config: RabbitMqWorkQueueConfig): RabbitMqConsumer {
  return createConsumer(config.url, config.prefetch ?? 10, async (channel) => {
    await channel.assertQueue(config.queue, { durable: true })
    return config.queue
  })
}

export interface RabbitMqTopicConsumerConfig {
  url: string
  exchange: string
  /** The service-owned durable queue bound to the exchange. */
  queue: string
  /** Routing-key patterns to bind (e.g. `friend_request.accepted`, `friendship.removed`). */
  patterns: string[]
  prefetch?: number
}

/**
 * A **topic** consumer: asserts the shared topic exchange, declares a durable
 * service-owned queue, binds it to the given patterns, and consumes. Used by
 * chat-service to build its friends read-model from `domain.events` (T7).
 */
export function createRabbitMqTopicConsumer(config: RabbitMqTopicConsumerConfig): RabbitMqConsumer {
  return createConsumer(config.url, config.prefetch ?? 10, async (channel) => {
    await channel.assertExchange(config.exchange, 'topic', { durable: true })
    await channel.assertQueue(config.queue, { durable: true })
    for (const pattern of config.patterns) {
      await channel.bindQueue(config.queue, config.exchange, pattern)
    }
    return config.queue
  })
}

/**
 * Shared consumer plumbing: lazily connect, run `topology` to declare/bind and
 * return the queue to read, set prefetch, then ack-on-success / nack-on-throw.
 * Malformed (non-JSON) bodies are acked and dropped — they can never succeed.
 */
function createConsumer(
  url: string,
  prefetch: number,
  topology: (channel: Channel) => Promise<string>,
): RabbitMqConsumer {
  let setup: Promise<{ conn: ChannelModel; channel: Channel }> | null = null

  return {
    async start(handler: RabbitMqHandler): Promise<void> {
      if (setup) return
      setup = (async () => {
        const conn = await connect(url)
        const channel = await conn.createChannel()
        const queue = await topology(channel)
        await channel.prefetch(prefetch)
        await channel.consume(queue, (msg) => {
          if (!msg) return // consumer cancelled by the broker
          void dispatch(channel, handler, msg)
        })
        return { conn, channel }
      })()
      await setup
    },
    async close(): Promise<void> {
      if (setup) {
        const { conn } = await setup
        await conn.close()
      }
    },
  }
}

async function dispatch(channel: Channel, handler: RabbitMqHandler, msg: ConsumeMessage): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse(msg.content.toString())
  } catch {
    console.error('[platform] dropping non-JSON delivery', { routingKey: msg.fields.routingKey })
    channel.ack(msg) // unparseable: never going to succeed, don't requeue-loop it
    return
  }
  try {
    await handler({
      body,
      messageId: msg.properties.messageId || undefined,
      routingKey: msg.fields.routingKey,
    })
    channel.ack(msg)
  } catch (err) {
    // Unexpected failure: nack without requeue so a poison message can't loop.
    console.error('[platform] consumer handler failed', err)
    channel.nack(msg, false, false)
  }
}
