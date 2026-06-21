import type { Clock } from '../../application/ports/clock.js'
import type { IdGenerator } from '../../application/ports/id-generator.js'
import type { PasswordHasher } from '../../application/ports/password-hasher.js'
import type { RefreshTokenRepository } from '../../application/ports/refresh-token-repository.js'
import type { UserRepository } from '../../application/ports/user-repository.js'
import type { User } from '../../domain/user.js'
import type { RefreshTokenRecord } from '../../domain/refresh-token.js'
import { EmailAlreadyInUseError } from '../../domain/errors.js'

/** Advanceable clock for deterministic TTL/expiry tests. */
export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000)
  }
}

/** Deterministic, monotonic id generator (not real UUIDv7, but unique + sortable). */
export class SequentialIdGenerator implements IdGenerator {
  private n = 0
  constructor(private readonly prefix = 'id') {}
  next(): string {
    this.n += 1
    return `${this.prefix}-${String(this.n).padStart(6, '0')}`
  }
}

/**
 * Fast fake hasher (no Argon2) for use-case/HTTP acceptance tests. The real
 * Argon2id adapter is covered separately in argon2-password-hasher.test.ts.
 * Crucially it still produces a hash distinct from the plaintext, so the
 * "never store plaintext" assertions (AC-R4) are meaningful.
 */
export const fakeHasher: PasswordHasher = {
  // base64 so the stored hash never contains the plaintext as a substring,
  // keeping the AC-R4 "plaintext not stored" assertion meaningful.
  hash: async (plaintext) => `fakehash:${Buffer.from(plaintext).toString('base64')}`,
  verify: async (hash, plaintext) =>
    hash === `fakehash:${Buffer.from(plaintext).toString('base64')}`,
}

export class InMemoryUserRepository implements UserRepository {
  readonly rows = new Map<string, User>()

  async findByEmail(email: string): Promise<User | null> {
    for (const u of this.rows.values()) if (u.email === email) return u
    return null
  }
  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null
  }
  async create(user: User): Promise<void> {
    if (await this.findByEmail(user.email)) throw new EmailAlreadyInUseError()
    this.rows.set(user.id, user)
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  readonly rows = new Map<string, RefreshTokenRecord>()

  async save(token: RefreshTokenRecord): Promise<void> {
    this.rows.set(token.id, token)
  }
  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const t of this.rows.values()) if (t.tokenHash === tokenHash) return t
    return null
  }
  async revoke(id: string, revokedAt: Date): Promise<void> {
    const t = this.rows.get(id)
    if (t && t.revokedAt === null) this.rows.set(id, { ...t, revokedAt })
  }
  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    for (const [id, t] of this.rows) {
      if (t.familyId === familyId && t.revokedAt === null) {
        this.rows.set(id, { ...t, revokedAt })
      }
    }
  }
}
