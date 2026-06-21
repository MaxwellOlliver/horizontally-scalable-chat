/**
 * Mints opaque refresh tokens and hashes them for storage (spec §2.5). The
 * plaintext is returned to the client exactly once; only `hash(plaintext)` is
 * ever persisted or compared (AC-T3).
 */
export interface GeneratedRefreshToken {
  /** Opaque value handed to the client — never stored. */
  plaintext: string
  /** Deterministic hash stored in / matched against the DB. */
  hash: string
}

export interface RefreshTokenService {
  generate(): GeneratedRefreshToken
  hash(plaintext: string): string
}
