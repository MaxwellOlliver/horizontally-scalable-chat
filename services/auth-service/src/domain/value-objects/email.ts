import { InvalidEmailError } from '../errors.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Email value object. Normalises to a canonical lowercase/trimmed form so
 * uniqueness checks are case-insensitive (the column is `citext`, but we
 * normalise here too so the value is canonical before it ever reaches the DB).
 */
export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase()
    if (normalized.length > 254 || !EMAIL_RE.test(normalized)) {
      throw new InvalidEmailError()
    }
    return new Email(normalized)
  }

  toString(): string {
    return this.value
  }
}
