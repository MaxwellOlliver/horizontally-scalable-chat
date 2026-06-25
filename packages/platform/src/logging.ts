import os from 'node:os'

/**
 * Observability log stream (study-project feature). In a horizontally-scaled
 * deployment a single user action fans across many instances — an HTTP request
 * lands on one of N service replicas, a queued message is handled by whichever
 * consumer grabbed it. To make that *visible*, every instance emits a short,
 * objective log line tagged with its own id and ships it to the affected
 * user(s). The transport reuses the exact path that already makes the system
 * scalable: publish to a per-user Redis channel, and whichever gateway instance
 * holds that user's socket forwards it down the WebSocket as a `log` frame.
 *
 * Best-effort and ephemeral: no persistence, no ordering guarantees, and a
 * failed publish never touches the request/work path it describes.
 */

/** The per-user log channel (`logs:{id}`) — distinct from the `user:{id}`
 * domain-delivery channel so log volume never pollutes message delivery. */
export const logChannel = (userId: string): string => `logs:${userId}`

/**
 * The cross-language envelope (TS services + Go gateway both emit this shape).
 * `instance` is the exact emitter (e.g. `chat-service-a3f1`); `source` is its
 * service category (e.g. `chat-service`) so the client can group/colour without
 * parsing the instance string.
 */
export interface LogFrame {
  type: 'log'
  data: {
    instance: string
    source: string
    event: string
    at: string
    detail?: Record<string, unknown>
  }
}

/** Fire-and-forget log emitter. `emit` never throws and never blocks the
 * caller's path — a publish failure is swallowed (logged to stderr). */
export interface LogEmitter {
  emit(userIds: string | readonly string[], event: string, detail?: Record<string, unknown>): void
}

export interface LoggerConfig {
  /** This process's unique id, e.g. `chat-service-a3f1`. */
  instanceId: string
  /** The service category, e.g. `chat-service`. */
  source: string
  /** Transport — injected so the logger stays decoupled and unit-testable. */
  publish: (channel: string, message: unknown) => Promise<void>
  /** Override for tests. */
  now?: () => Date
}

export function createLogger(config: LoggerConfig): LogEmitter {
  const { instanceId, source, publish } = config
  const now = config.now ?? (() => new Date())

  return {
    emit(userIds, event, detail) {
      const targets = typeof userIds === 'string' ? [userIds] : userIds
      const frame: LogFrame = {
        type: 'log',
        data: {
          instance: instanceId,
          source,
          event,
          at: now().toISOString(),
          ...(detail ? { detail } : {}),
        },
      }
      // Dedup so an action where actor === counterparty isn't double-logged.
      for (const userId of new Set(targets)) {
        publish(logChannel(userId), frame).catch((err) =>
          console.error(`[${instanceId}] log publish failed -> ${userId}`, err),
        )
      }
    },
  }
}

/** A logger that discards everything — a safe default for tests and any path
 * without a transport wired. */
export const noopLogger: LogEmitter = { emit() {} }

/**
 * Derives this process's instance id. An explicit `INSTANCE_ID` (set when
 * instances are defined as separate compose services) always wins; otherwise it
 * is `{source}-{short hostname}`. Under `docker compose --scale` each replica
 * gets a distinct container hostname, so the ids stay unique and stable per
 * process without any per-replica configuration.
 */
export function resolveInstanceId(source: string): string {
  const explicit = process.env.INSTANCE_ID?.trim()
  if (explicit) return explicit
  const host = (process.env.HOSTNAME?.trim() || os.hostname()).replace(/[^a-z0-9]/gi, '')
  return `${source}-${host.slice(0, 6) || 'local'}`
}
