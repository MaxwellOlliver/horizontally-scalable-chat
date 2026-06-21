import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import { createAuthRoutes, type AuthUseCases } from './interface/http/routes/auth.js'

/**
 * Builds the Elysia app (no `.listen`) so tests can drive it via `app.handle`
 * and the entry point can own the listen call.
 */
export function createApp(useCases: AuthUseCases) {
  return new Elysia({ adapter: node() })
    .get('/health', () => ({ status: 'ok', service: 'auth-service' }))
    .use(createAuthRoutes(useCases))
}
