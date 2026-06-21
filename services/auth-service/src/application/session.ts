import type { RefreshTokenRecord } from '../domain/refresh-token.js'
import type { Clock } from './ports/clock.js'
import type { IdGenerator } from './ports/id-generator.js'
import type { RefreshTokenRepository } from './ports/refresh-token-repository.js'
import type { RefreshTokenService } from './ports/refresh-token-service.js'
import type { TokenIssuer } from './ports/token-issuer.js'

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  /** Seconds until the access token expires. */
  expiresIn: number
}

export interface SessionDeps {
  tokenIssuer: TokenIssuer
  refreshTokens: RefreshTokenRepository
  refreshTokenService: RefreshTokenService
  ids: IdGenerator
  clock: Clock
  refreshTtlSeconds: number
}

/**
 * Issues an access token plus a freshly-minted refresh token belonging to
 * `familyId`, persisting only the refresh token's HASH (AC-T3). Used by login
 * (new family) and refresh (continuing an existing family).
 */
export async function issueSession(
  deps: SessionDeps,
  userId: string,
  familyId: string,
): Promise<SessionTokens> {
  const now = deps.clock.now()
  const access = await deps.tokenIssuer.issueAccessToken(userId)
  const refresh = deps.refreshTokenService.generate()

  const record: RefreshTokenRecord = {
    id: deps.ids.next(),
    userId,
    familyId,
    tokenHash: refresh.hash,
    expiresAt: new Date(now.getTime() + deps.refreshTtlSeconds * 1000),
    revokedAt: null,
    createdAt: now,
  }
  await deps.refreshTokens.save(record)

  return {
    accessToken: access.token,
    refreshToken: refresh.plaintext,
    expiresIn: access.expiresIn,
  }
}
