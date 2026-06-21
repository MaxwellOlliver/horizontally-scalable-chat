import type { User } from '../../domain/user.js'

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>
  findById(id: string): Promise<User | null>
  /**
   * Persists a new user. Implementations MUST surface a unique-violation on
   * email as `EmailAlreadyInUseError` so registration races resolve to 409
   * (AC-R2) rather than a 500.
   */
  create(user: User): Promise<void>
}
