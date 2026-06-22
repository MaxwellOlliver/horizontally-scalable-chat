import type { Env } from './config/env.js'
import type { Clock } from './application/ports/clock.js'
import { systemClock } from './application/ports/clock.js'
import type { IdGenerator } from './application/ports/id-generator.js'
import type { PasswordHasher } from './application/ports/password-hasher.js'
import type { RefreshTokenRepository } from './application/ports/refresh-token-repository.js'
import type { RefreshTokenService } from './application/ports/refresh-token-service.js'
import type { TokenIssuer } from './application/ports/token-issuer.js'
import type { UserRepository } from './application/ports/user-repository.js'
import type { SessionDeps } from './application/session.js'
import { AuthenticateUser } from './application/use-cases/authenticate-user.js'
import { RefreshSession } from './application/use-cases/refresh-session.js'
import { RegisterUser } from './application/use-cases/register-user.js'
import { RevokeSession } from './application/use-cases/revoke-session.js'
import { uuidv7Generator } from '@hsc/platform'
import { createDatabase, type Database } from './infrastructure/db/client.js'
import { createDrizzleRefreshTokenRepository } from './infrastructure/repositories/drizzle-refresh-token-repository.js'
import { createDrizzleUserRepository } from './infrastructure/repositories/drizzle-user-repository.js'
import { argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js'
import { createJwtTokenIssuer } from './infrastructure/security/jwt-token-issuer.js'
import { sha256RefreshTokenService } from './infrastructure/security/sha256-refresh-token-service.js'
import type { AuthUseCases } from './interface/http/routes/auth.js'

/** Everything the use-case layer depends on, as ports (clean-arch boundary). */
export interface AuthPorts {
  users: UserRepository
  refreshTokens: RefreshTokenRepository
  hasher: PasswordHasher
  tokenIssuer: TokenIssuer
  refreshTokenService: RefreshTokenService
  ids: IdGenerator
  clock: Clock
  refreshTtlSeconds: number
  /** Argon2id hash of a throwaway value, for login timing equalisation. */
  dummyHash: string
}

/**
 * Pure assembly of the use cases from ports. Production and tests both call
 * this — production passes Drizzle/Argon2/JWT adapters, tests pass in-memory
 * fakes — so the wiring under test is the real wiring.
 */
export function assembleUseCases(ports: AuthPorts): AuthUseCases {
  const session: SessionDeps = {
    tokenIssuer: ports.tokenIssuer,
    refreshTokens: ports.refreshTokens,
    refreshTokenService: ports.refreshTokenService,
    ids: ports.ids,
    clock: ports.clock,
    refreshTtlSeconds: ports.refreshTtlSeconds,
  }

  return {
    registerUser: new RegisterUser(ports.users, ports.hasher, ports.ids, ports.clock),
    authenticateUser: new AuthenticateUser(
      ports.users,
      ports.hasher,
      session,
      ports.dummyHash,
    ),
    refreshSession: new RefreshSession(session),
    revokeSession: new RevokeSession(
      ports.refreshTokens,
      ports.refreshTokenService,
      ports.clock,
    ),
  }
}

export interface Container {
  useCases: AuthUseCases
  db: Database
}

/** Production container: real adapters wired from validated env. */
export async function createContainer(env: Env): Promise<Container> {
  const db = createDatabase(env.DATABASE_URL)
  const clock = systemClock

  const tokenIssuer = createJwtTokenIssuer({
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  })

  // Precompute once so the per-login dummy verify (timing equalisation) is cheap.
  const dummyHash = await argon2PasswordHasher.hash(uuidv7Generator.next())

  const useCases = assembleUseCases({
    users: createDrizzleUserRepository(db),
    refreshTokens: createDrizzleRefreshTokenRepository(db),
    hasher: argon2PasswordHasher,
    tokenIssuer,
    refreshTokenService: sha256RefreshTokenService,
    ids: uuidv7Generator,
    clock,
    refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    dummyHash,
  })

  return { useCases, db }
}
