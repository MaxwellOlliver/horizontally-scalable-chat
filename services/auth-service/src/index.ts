import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

const port = Number(process.env.PORT ?? 3000)

export const app = new Elysia({ adapter: node() })
  .get('/health', () => ({ status: 'ok', service: 'auth-service' }))
  // Auth routes (see specs/auth.spec.md §2.6) get mounted here as they are built:
  //   POST /auth/register · /auth/login · /auth/refresh · /auth/logout
  .listen(port, ({ hostname, port }) => {
    console.log(`🔐 auth-service listening on http://${hostname}:${port}`)
  })
