/**
 * Password hashing port. The infrastructure adapter uses Argon2id (AC-R4,
 * non-functional reqs). `verify` must be constant-time with respect to the
 * stored hash.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>
  verify(hash: string, plaintext: string): Promise<boolean>
}
