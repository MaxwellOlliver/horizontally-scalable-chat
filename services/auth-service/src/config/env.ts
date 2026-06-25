import { z } from 'zod'

/**
 * Validated runtime configuration. Parsed once at startup so a misconfigured
 * deploy fails fast instead of minting unverifiable tokens later.
 *
 * The signing secret + TTLs are a cross-language contract with the Go gateway
 * (spec §2.8): both services must read the same JWT_SECRET to verify locally.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  // Observability log stream — publishes per-user log frames the gateway relays.
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ISSUER: z.string().min(1).default('hsc-auth'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1_296_000),
  PORT: z.coerce.number().int().positive().default(3000),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    // Surface the offending keys without echoing their (possibly secret) values.
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid environment configuration: ${keys}`)
  }
  return parsed.data
}
