import { InvalidCredentialsError } from '../../domain/errors.js'
import { Email } from '../../domain/value-objects/email.js'
import type { PasswordHasher } from '../ports/password-hasher.js'
import type { UserRepository } from '../ports/user-repository.js'
import { issueSession, type SessionDeps, type SessionTokens } from '../session.js'

export interface AuthenticateUserInput {
  email: string
  password: string
}

/**
 * AuthenticateUser / login (AC-L1..L3). On valid credentials, starts a NEW
 * refresh-token family (one per device login) and returns access + refresh
 * tokens. Every failure path returns the same generic error (AC-L2).
 *
 * A dummy hash verify runs when the user is unknown so response timing does not
 * reveal whether the email exists.
 */
export class AuthenticateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly session: SessionDeps,
    // Argon2id hash of a random throwaway value, used for timing equalisation.
    private readonly dummyHash: string,
  ) {}

  async execute(input: AuthenticateUserInput): Promise<SessionTokens> {
    let email: Email
    try {
      email = Email.create(input.email)
    } catch {
      // Invalid-shaped email is just another invalid credential (AC-L2).
      await this.hasher.verify(this.dummyHash, input.password)
      throw new InvalidCredentialsError()
    }

    const user = await this.users.findByEmail(email.value)
    if (!user) {
      await this.hasher.verify(this.dummyHash, input.password)
      throw new InvalidCredentialsError()
    }

    const ok = await this.hasher.verify(user.passwordHash, input.password)
    if (!ok) {
      throw new InvalidCredentialsError()
    }

    const familyId = this.session.ids.next()
    return issueSession(this.session, user.id, familyId)
  }
}
