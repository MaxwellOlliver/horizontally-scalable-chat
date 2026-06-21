import { createHash, randomBytes } from 'node:crypto'
import type {
  GeneratedRefreshToken,
  RefreshTokenService,
} from '../../application/ports/refresh-token-service.js'

/**
 * Opaque refresh tokens (spec §2.2): 256 bits of CSPRNG entropy, base64url.
 *
 * Storage holds only `sha256(token)` (AC-T3). A plain SHA-256 (not a slow KDF)
 * is appropriate here because the token is high-entropy random — there is
 * nothing to brute-force — and lookups must be a cheap, deterministic hash.
 */
export const sha256RefreshTokenService: RefreshTokenService = {
  generate(): GeneratedRefreshToken {
    const plaintext = randomBytes(32).toString('base64url')
    return { plaintext, hash: sha256(plaintext) }
  },
  hash(plaintext: string): string {
    return sha256(plaintext)
  },
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
