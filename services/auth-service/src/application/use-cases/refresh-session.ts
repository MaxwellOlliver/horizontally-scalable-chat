import { InvalidRefreshTokenError } from '../../domain/errors.js'
import { isExpired, isRevoked } from '../../domain/refresh-token.js'
import { issueSession, type SessionDeps, type SessionTokens } from '../session.js'

export interface RefreshSessionInput {
  refreshToken: string
}

/**
 * RefreshSession (AC-T1..T4). Presenting a valid, active token rotates it:
 * a new token is issued in the same family and the presented one is revoked.
 *
 * Reuse detection (AC-T4): presenting a token that is ALREADY revoked signals
 * theft (an old token was replayed). We revoke the entire family and reject,
 * forcing a fresh login. Expired/unknown tokens are simply rejected (AC-T2).
 */
export class RefreshSession {
  constructor(private readonly session: SessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<SessionTokens> {
    const { refreshTokens, refreshTokenService, clock } = this.session

    const tokenHash = refreshTokenService.hash(input.refreshToken)
    const record = await refreshTokens.findByHash(tokenHash)
    if (!record) {
      throw new InvalidRefreshTokenError()
    }

    const now = clock.now()

    // AC-T4 — replay of a used/revoked token => treat as theft, kill the family.
    if (isRevoked(record)) {
      await refreshTokens.revokeFamily(record.familyId, now)
      throw new InvalidRefreshTokenError()
    }

    // AC-T2 — expired tokens are rejected (no rotation).
    if (isExpired(record, now)) {
      throw new InvalidRefreshTokenError()
    }

    // Rotate: revoke the presented token, then issue its successor in-family.
    await refreshTokens.revoke(record.id, now)
    return issueSession(this.session, record.userId, record.familyId)
  }
}
