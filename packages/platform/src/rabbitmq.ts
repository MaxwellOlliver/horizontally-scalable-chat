import { connect, type Channel, type ChannelModel } from 'amqplib'

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
