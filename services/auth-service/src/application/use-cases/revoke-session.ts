import type { Clock } from '../ports/clock.js'
import type { RefreshTokenRepository } from '../ports/refresh-token-repository.js'
import type { RefreshTokenService } from '../ports/refresh-token-service.js'

export interface RevokeSessionInput {
  refreshToken: string
}

/**
 * RevokeSession / logout (AC-O1). Revokes the whole refresh-token family so the
 * session can no longer be refreshed. Outstanding access tokens remain valid
 * until their (short) natural expiry — revocation lives at the refresh layer.
 *
 * Idempotent and silent: an unknown/already-revoked token still resolves to a
 * successful logout (the route returns 204) and never reveals token validity.
 */
export class RevokeSession {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly clock: Clock,
  ) {}

  async execute(input: RevokeSessionInput): Promise<void> {
    const tokenHash = this.refreshTokenService.hash(input.refreshToken)
    const record = await this.refreshTokens.findByHash(tokenHash)
    if (!record) {
      return
    }
    await this.refreshTokens.revokeFamily(record.familyId, this.clock.now())
  }
}
