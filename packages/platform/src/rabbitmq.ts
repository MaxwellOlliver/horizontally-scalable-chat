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
    if (!setup) {
      setup = (async () => {
        const conn = await connect(config.url)
        // A dropped connection resets the cache so the next publish reconnects.
        conn.on('error', () => {})
        conn.on('close', () => {
          setup = null
        })
        const channel = await conn.createChannel()
        await channel.assertExchange(config.exchange, 'topic', { durable: true })
        return { conn, channel }
      })().catch((err) => {
        // Don't cache a rejected setup (e.g. broker not up yet): reset so the
        // next publish retries instead of failing for the process's lifetime.
        setup = null
        throw err
      })
    }
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

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Shared consumer plumbing: connect, run `topology` to declare/bind and return
 * the queue to read, set prefetch, then ack-on-success / nack-on-throw.
 * Malformed (non-JSON) bodies are acked and dropped — they can never succeed.
 *
 * Connecting is resilient: the broker is routinely not-yet-ready at startup (or
 * restarts/deploys), so `start()` kicks off a retry-with-backoff loop and
 * returns immediately rather than throwing — a refused connection must not crash
 * the service. When an established connection drops, it reconnects and resumes
 * consuming.
 */
function createConsumer(
  url: string,
  prefetch: number,
  topology: (channel: Channel) => Promise<string>,
): RabbitMqConsumer {
  let handler: RabbitMqHandler | null = null
  let conn: ChannelModel | null = null
  let started = false
  let closed = false

  async function connectOnce(): Promise<void> {
    const c = await connect(url)
    const channel = await c.createChannel()
    const queue = await topology(channel)
    await channel.prefetch(prefetch)
    await channel.consume(queue, (msg) => {
      if (!msg || !handler) return // consumer cancelled by the broker
      void dispatch(channel, handler, msg)
    })
    conn = c
    // amqplib emits 'close' (after 'error'); reconnect unless we asked to stop.
    c.on('error', () => {})
    c.on('close', () => {
      conn = null
      if (!closed) void runConnectLoop()
    })
  }

  async function runConnectLoop(): Promise<void> {
    let attempt = 0
    while (!closed) {
      try {
        await connectOnce()
        return
      } catch (err) {
        attempt += 1
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt - 1, 5), RECONNECT_MAX_MS)
        const reason = err instanceof Error ? err.message : String(err)
        console.error(
          `[platform] rabbitmq consumer connect failed (attempt ${attempt}); retrying in ${delay}ms: ${reason}`,
        )
        await sleep(delay)
      }
    }
  }

  return {
    async start(h: RabbitMqHandler): Promise<void> {
      handler = h
      if (started) return
      started = true
      void runConnectLoop() // fire-and-forget: don't block startup on the broker
    },
    async close(): Promise<void> {
      closed = true
      if (conn) {
        const c = conn
        conn = null
        await c.close().catch(() => {})
      }
    },
  }
}

async function dispatch(
  channel: Channel,
  handler: RabbitMqHandler,
  msg: ConsumeMessage,
): Promise<void> {
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
