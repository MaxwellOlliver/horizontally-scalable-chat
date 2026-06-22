import { z } from 'zod'

/**
 * Validated runtime configuration, parsed once at startup. JWT_SECRET/JWT_ISSUER
 * are the shared contract with auth-service used to authenticate callers.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ISSUER: z.string().min(1).default('hsc-auth'),
  RABBITMQ_URL: z.string().min(1),
  DOMAIN_EVENTS_EXCHANGE: z.string().min(1).default('domain.events'),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
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
