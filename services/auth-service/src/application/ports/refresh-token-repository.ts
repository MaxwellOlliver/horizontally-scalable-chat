import type { RefreshTokenRecord } from '../../domain/refresh-token.js'

export interface RefreshTokenRepository {
  save(token: RefreshTokenRecord): Promise<void>
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>
  /** Marks a single token revoked (used during normal rotation). */
  revoke(id: string, revokedAt: Date): Promise<void>
  /**
   * Revokes every not-yet-revoked token in a family (logout AC-O1, and reuse
   * detection AC-T4). Idempotent.
   */
  revokeFamily(familyId: string, revokedAt: Date): Promise<void>
}
