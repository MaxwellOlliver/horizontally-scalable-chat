import { WeakPasswordError } from '../errors.js'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 1024 // bound work for the hasher / avoid DoS

/**
 * A plaintext password that has passed policy (AC-R3). This object only ever
 * holds the value transiently on its way to the hasher — it is never persisted
 * or logged (AC-R4). `toString` is masked to avoid accidental leakage.
 */
export class Password {
  private constructor(private readonly plaintext: string) {}

  static create(raw: string): Password {
    if (typeof raw !== 'string' || raw.length < PASSWORD_MIN_LENGTH) {
      throw new WeakPasswordError(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      )
    }
    if (raw.length > PASSWORD_MAX_LENGTH) {
      throw new WeakPasswordError('Password is too long')
    }
    return new Password(raw)
  }

  /** Expose the raw value only at the hashing boundary. */
  reveal(): string {
    return this.plaintext
  }

  toString(): string {
    return '[redacted]'
  }

  toJSON(): string {
    return '[redacted]'
  }
}
