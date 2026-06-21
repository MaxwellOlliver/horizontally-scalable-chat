import { describe, expect, it } from 'vitest'
import { argon2PasswordHasher } from '../../infrastructure/security/argon2-password-hasher.js'

/** The real Argon2id adapter (the fakes elsewhere stand in for speed). */
describe('Argon2idPasswordHasher', () => {
  it('produces an argon2id encoded hash that is not the plaintext (AC-R4)', async () => {
    const hash = await argon2PasswordHasher.hash('a-strong-password')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(hash).not.toContain('a-strong-password')
  })

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await argon2PasswordHasher.hash('a-strong-password')
    expect(await argon2PasswordHasher.verify(hash, 'a-strong-password')).toBe(true)
    expect(await argon2PasswordHasher.verify(hash, 'wrong-password')).toBe(false)
  })

  it('returns false (not throw) for a malformed stored hash', async () => {
    expect(await argon2PasswordHasher.verify('not-a-hash', 'whatever')).toBe(false)
  })
})
