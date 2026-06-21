import { eq } from 'drizzle-orm'
import { EmailAlreadyInUseError } from '../../domain/errors.js'
import type { User } from '../../domain/user.js'
import type { UserRepository } from '../../application/ports/user-repository.js'
import type { Database } from '../db/client.js'
import { users, type UserRow } from '../db/schema.js'

const UNIQUE_VIOLATION = '23505'

export function createDrizzleUserRepository(db: Database): UserRepository {
  return {
    async findByEmail(email: string): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      return row ? toDomain(row) : null
    },

    async findById(id: string): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
      return row ? toDomain(row) : null
    },

    async create(user: User): Promise<void> {
      try {
        await db.insert(users).values({
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          displayName: user.displayName,
          createdAt: user.createdAt,
        })
      } catch (err) {
        // Closes the check-then-insert race on email uniqueness (AC-R2).
        if (isUniqueViolation(err)) {
          throw new EmailAlreadyInUseError()
        }
        throw err
      }
    },
  }
}

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    createdAt: row.createdAt,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  )
}
