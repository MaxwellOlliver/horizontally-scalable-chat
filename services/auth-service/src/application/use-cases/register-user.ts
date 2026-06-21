import { createUser } from '../../domain/user.js'
import { EmailAlreadyInUseError } from '../../domain/errors.js'
import { Email } from '../../domain/value-objects/email.js'
import { Password } from '../../domain/value-objects/password.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { PasswordHasher } from '../ports/password-hasher.js'
import type { UserRepository } from '../ports/user-repository.js'

export interface RegisterUserInput {
  email: string
  password: string
  displayName: string
}

export interface RegisterUserResult {
  userId: string
}

/**
 * RegisterUser (AC-R1..R4). Validates the email + password policy, ensures the
 * email is unique, stores only an Argon2id hash, and assigns a UUIDv7.
 */
export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterUserInput): Promise<RegisterUserResult> {
    const email = Email.create(input.email) // throws InvalidEmailError -> 422
    const password = Password.create(input.password) // throws WeakPasswordError -> 422

    // Fast-path uniqueness check (AC-R2). The repository also enforces this at
    // the DB level to close the check-then-insert race.
    const existing = await this.users.findByEmail(email.value)
    if (existing) {
      throw new EmailAlreadyInUseError()
    }

    const passwordHash = await this.hasher.hash(password.reveal())

    const user = createUser({
      id: this.ids.next(),
      email,
      passwordHash,
      displayName: input.displayName.trim(),
      createdAt: this.clock.now(),
    })
    await this.users.create(user)

    return { userId: user.id }
  }
}
