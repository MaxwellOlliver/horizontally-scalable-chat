import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import type { AccessTokenVerifier } from '@hsc/platform'
import { createChatRoutes, type ChatUseCases } from './interface/http/routes/chat.js'

/**
 * Builds the Elysia app (no `.listen`) so tests can drive it via `app.handle`
 * and the entry point can own the listen call. Sending is async over the inbound
 * queue (not HTTP); this app only serves the synchronous history reads + health.
 */
export function createApp(useCases: ChatUseCases, verifier: AccessTokenVerifier) {
  return new Elysia({ adapter: node() })
    .get('/health', () => ({ status: 'ok', service: 'chat-service' }))
    .use(createChatRoutes({ useCases, verifier }))
}
