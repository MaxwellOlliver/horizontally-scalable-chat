/**
 * Refresh-token record (spec §2.5). We persist only a HASH of the opaque token
 * (AC-T3); the plaintext is returned to the client once and never stored.
 *
 * Tokens are grouped into a `familyId`: one family per device login. Rotation
 * issues a new token in the family and revokes its predecessor; replay of an
 * already-revoked token revokes the whole family (AC-T1, AC-T4).
 */
export interface RefreshTokenRecord {
  readonly id: string
  readonly userId: string
  readonly familyId: string
  readonly tokenHash: string
  readonly expiresAt: Date
  readonly revokedAt: Date | null
  readonly createdAt: Date
}

export function isExpired(token: RefreshTokenRecord, now: Date): boolean {
  return token.expiresAt.getTime() <= now.getTime()
}

export function isRevoked(token: RefreshTokenRecord): boolean {
  return token.revokedAt !== null
}

/** A token is usable only if it is neither revoked nor expired. */
export function isActive(token: RefreshTokenRecord, now: Date): boolean {
  return !isRevoked(token) && !isExpired(token, now)
}
