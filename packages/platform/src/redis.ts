import { createClient } from 'redis'

/**
 * A lazy Redis pub/sub publisher. Both social-service (friend list-update
 * frames) and chat-service (message delivery) publish to per-user channels that
 * the gateway subscribes to; the connection management is identical, so it
 * lives here. Non-string payloads are JSON-encoded.
 */
export interface RedisPublisher {
  publish(channel: string, message: unknown): Promise<void>
  close(): Promise<void>
}

/** The per-user delivery channel convention (`user:{id}`) shared by services. */
export const userChannel = (userId: string): string => `user:${userId}`

export function createRedisPublisher(url: string): RedisPublisher {
  const client = createClient({ url })
  // node-redis emits 'error' on connection trouble; with no listener those
  // surface as unhandled exceptions that crash the process. Log instead — the
  // publisher is best-effort, callers decide what a failed publish means.
  client.on('error', (err) => console.error('[platform] redis client error', err))

  let ready: Promise<unknown> | null = null

  function connect(): Promise<unknown> {
    if (!ready) {
      ready = client.connect().catch((err) => {
        // Don't cache a rejected promise: reset so the next publish reconnects
        // (e.g. Redis was briefly unreachable at startup). Otherwise this client
        // would fail every publish for the rest of the process's life.
        ready = null
        throw err
      })
    }
    return ready
  }

  return {
    async publish(channel: string, message: unknown): Promise<void> {
      await connect()
      const payload = typeof message === 'string' ? message : JSON.stringify(message)
      await client.publish(channel, payload)
    },
    async close(): Promise<void> {
      if (client.isOpen) {
        await client.quit()
      }
    },
  }
}
