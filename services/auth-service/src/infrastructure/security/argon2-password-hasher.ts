import { Algorithm, hash, verify } from '@node-rs/argon2'
import type { PasswordHasher } from '../../application/ports/password-hasher.js'

/**
 * Argon2id password hasher (AC-R4 / non-functional reqs). Parameters follow
 * OWASP guidance (>=19 MiB, t=2, p=1). The encoded output embeds the salt and
 * params, so no separate salt column is needed.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
} as const

export const argon2PasswordHasher: PasswordHasher = {
  hash: (plaintext) => hash(plaintext, OPTIONS),
  verify: async (storedHash, plaintext) => {
    try {
      return await verify(storedHash, plaintext, OPTIONS)
    } catch {
      // Malformed hash etc. — treat as a non-match rather than throwing.
      return false
    }
  },
}
