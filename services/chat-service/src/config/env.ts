import { z } from 'zod'

/**
 * Validated runtime configuration, parsed once at startup. JWT_SECRET/JWT_ISSUER
 * are the shared contract with auth-service used to authenticate history reads.
 * The RabbitMQ queues are the inbound client-message work queue and the
 * service-owned queue bound to the `domain.events` exchange for friend events.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ISSUER: z.string().min(1).default('hsc-auth'),
  RABBITMQ_URL: z.string().min(1),
  DOMAIN_EVENTS_EXCHANGE: z.string().min(1).default('domain.events'),
  INBOUND_QUEUE: z.string().min(1).default('chat.inbound'),
  FRIEND_EVENTS_QUEUE: z.string().min(1).default('chat.friend-events'),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3002),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid environment configuration: ${keys}`)
  }
  return parsed.data
}
