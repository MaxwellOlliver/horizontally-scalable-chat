import { SignJWT } from 'jose'
import { uuidv7 } from 'uuidv7'
import { createApp } from '../../app.js'
import { assembleUseCases, type SocialPorts } from '../../composition-root.js'
import type { LivePush } from '../../application/ports/live-push.js'
import { createJwtAccessTokenVerifier } from '@hsc/platform'
import {
  CapturingEventPublisher,
  CapturingLivePush,
  FakeClock,
  InMemoryFriendRequestRepository,
  InMemoryFriendshipRepository,
  InMemoryUserDirectory,
  SequentialUuidGenerator,
} from './fakes.js'

const SECRET = 'test-secret-test-secret-test-secret-123'
const ISSUER = 'hsc-auth-test'

export interface TestResponse {
  status: number
  body: any
}

export interface RequestOptions {
  token?: string
  body?: unknown
}

export interface TestUser {
  id: string
  token: string
  email: string
  displayName: string
}

export interface Harness {
  app: ReturnType<typeof createApp>
  friendRequests: InMemoryFriendRequestRepository
  friendships: InMemoryFriendshipRepository
  events: CapturingEventPublisher
  livePush: CapturingLivePush
  users: InMemoryUserDirectory
  clock: FakeClock
  /** Registers a known user (id + email + name) in the directory and returns a token. */
  createUser: (displayName?: string) => Promise<TestUser>
  /** Mints a valid HS256 access token for an arbitrary (possibly unknown) id. */
  tokenFor: (userId: string) => Promise<string>
  request: (method: string, path: string, opts?: RequestOptions) => Promise<TestResponse>
  /** Observability log lines captured from the routes. */
  logs: LogCapture[]
}

export interface LogCapture {
  userIds: string[]
  event: string
}

/**
 * Builds the real use-case wiring + Elysia app over in-memory fakes. The access
 * token verifier is the production HS256 adapter fed real signed JWTs, so the
 * auth path (401s) and the cross-service token contract are exercised for real.
 *
 * `livePush` can be overridden (e.g. with FailingLivePush) to prove pushes are
 * best-effort without affecting the durable lists (AC-P4).
 */
export function buildHarness(overrides: { livePush?: LivePush } = {}): Harness {
  const friendRequests = new InMemoryFriendRequestRepository()
  const friendships = new InMemoryFriendshipRepository()
  const events = new CapturingEventPublisher()
  const livePush = new CapturingLivePush()
  const users = new InMemoryUserDirectory()
  const clock = new FakeClock()

  const ports: SocialPorts = {
    friendRequests,
    friendships,
    events,
    livePush: overrides.livePush ?? livePush,
    users,
    ids: new SequentialUuidGenerator(),
    clock,
  }

  const verifier = createJwtAccessTokenVerifier(SECRET, ISSUER)
  const logs: LogCapture[] = []
  const app = createApp(assembleUseCases(ports), verifier, {
    emit: (userIds, event) =>
      logs.push({ userIds: typeof userIds === 'string' ? [userIds] : [...userIds], event }),
  })

  const key = new TextEncoder().encode(SECRET)
  const tokenFor = (userId: string): Promise<string> =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key)

  let userCount = 0
  const createUser = async (displayName?: string): Promise<TestUser> => {
    const id = uuidv7()
    userCount += 1
    const name = displayName ?? `User ${userCount}`
    const email = `user${userCount}-${id.slice(0, 8)}@test.dev`
    users.add(id, email, name)
    return { id, token: await tokenFor(id), email, displayName: name }
  }

  const request = async (
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<TestResponse> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
    )
    const text = await res.text()
    return { status: res.status, body: text ? safeJson(text) : null }
  }

  return {
    app,
    friendRequests,
    friendships,
    events,
    livePush,
    users,
    clock,
    createUser,
    tokenFor,
    request,
    logs,
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
