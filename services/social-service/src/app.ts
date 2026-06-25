import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import { noopLogger, type LogEmitter } from '@hsc/platform'
import type { AccessTokenVerifier } from './application/ports/access-token-verifier.js'
import { createSocialRoutes, type SocialUseCases } from './interface/http/routes/social.js'

/**
 * Builds the Elysia app (no `.listen`) so tests can drive it via `app.handle`
 * and the entry point can own the listen call. The logger defaults to a no-op
 * so tests need no transport; production passes a Redis-backed one.
 */
export function createApp(
  useCases: SocialUseCases,
  verifier: AccessTokenVerifier,
  logger: LogEmitter = noopLogger,
) {
  return new Elysia({ adapter: node() })
    .get('/health', () => ({ status: 'ok', service: 'social-service' }))
    .use(createSocialRoutes({ useCases, verifier, logger }))
}
