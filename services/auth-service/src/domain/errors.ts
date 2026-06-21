/**
 * Domain errors. Each carries a stable `code` the interface layer maps to an
 * HTTP status (see interface/http/error-mapper.ts). Messages are safe to return
 * to clients — in particular login failures are deliberately generic so they
 * cannot be used to enumerate accounts (AC-L2).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** AC-R3 — password fails policy. */
export class WeakPasswordError extends DomainError {
  readonly code = 'WEAK_PASSWORD'
  constructor(message = 'Password does not meet the minimum policy') {
    super(message)
  }
}

/** Email is syntactically invalid. */
export class InvalidEmailError extends DomainError {
  readonly code = 'INVALID_EMAIL'
  constructor(message = 'Email is not valid') {
    super(message)
  }
}

/** AC-R2 — email already registered. */
export class EmailAlreadyInUseError extends DomainError {
  readonly code = 'EMAIL_ALREADY_IN_USE'
  constructor(message = 'Email is already registered') {
    super(message)
  }
}

/** AC-L2 — single generic message for unknown email OR wrong password. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS'
  constructor(message = 'Invalid email or password') {
    super(message)
  }
}

/** AC-T2 — refresh token expired, revoked, or unknown. */
export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'INVALID_REFRESH_TOKEN'
  constructor(message = 'Invalid refresh token') {
    super(message)
  }
}
