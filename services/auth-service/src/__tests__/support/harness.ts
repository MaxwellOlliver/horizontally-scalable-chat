import { createApp } from '../../app.js'
import { assembleUseCases, type AuthPorts } from '../../composition-root.js'
import type { TokenIssuer } from '../../application/ports/token-issuer.js'
import { createJwtTokenIssuer } from '../../infrastructure/security/jwt-token-issuer.js'
import { sha256RefreshTokenService } from '../../infrastructure/security/sha256-refresh-token-service.js'
import {
  FakeClock,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
  fakeHasher,
} from './fakes.js'

const ACCESS_TTL = 600 // 10 min (spec)
const REFRESH_TTL = 1_296_000 // 15 days (spec)

export interface Harness {
  app: ReturnType<typeof createApp>
  users: InMemoryUserRepository
  refreshTokens: InMemoryRefreshTokenRepository
  clock: FakeClock
  tokenIssuer: TokenIssuer
  request: (method: string, path: string, body?: unknown) => Promise<TestResponse>
}

export interface TestResponse {
  status: number
  body: any
}

/**
 * Builds the real use-case wiring + Elysia app over in-memory fakes. Tokens are
 * real HS256 JWTs and real SHA-256 refresh hashes, so token-shape and
 * verify-without-DB assertions exercise production code paths.
 */
export function buildHarness(): Harness {
  const users = new InMemoryUserRepository()
  const refreshTokens = new InMemoryRefreshTokenRepository()
  const clock = new FakeClock()
  const tokenIssuer = createJwtTokenIssuer({
    secret: 'test-secret-test-secret-test-secret-123',
    issuer: 'hsc-auth-test',
    accessTtlSeconds: ACCESS_TTL,
  })

  const ports: AuthPorts = {
    users,
    refreshTokens,
    hasher: fakeHasher,
    tokenIssuer,
    refreshTokenService: sha256RefreshTokenService,
    ids: new SequentialIdGenerator('uid'),
    clock,
    refreshTtlSeconds: REFRESH_TTL,
    dummyHash: 'fakehash:__dummy__',
  }

  const app = createApp(assembleUseCases(ports))

  const request = async (method: string, path: string, body?: unknown): Promise<TestResponse> => {
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    return { status: res.status, body: text ? safeJson(text) : null }
  }

  return { app, users, refreshTokens, clock, tokenIssuer, request }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
