import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Case-insensitive text, backed by Postgres `citext` (spec §2.5). Requires the
 * `citext` extension — created in the initial migration.
 */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
})

/**
 * users (spec §2.5). `id` is an app-assigned UUIDv7 (no DB default — the server
 * mints it). Only the Argon2id `password_hash` is stored, never the plaintext
 * (AC-R4). `email` is citext + unique for case-insensitive uniqueness (AC-R2).
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * refresh_tokens (spec §2.5). Stores only the token HASH (AC-T3). `family_id`
 * groups a device's rotating tokens for reuse detection (AC-T4); `revoked_at`
 * is set on rotation, logout, or theft-triggered family revocation.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_family_id_idx').on(t.familyId),
    index('refresh_tokens_user_id_idx').on(t.userId),
  ],
)

export type UserRow = typeof users.$inferSelect
export type RefreshTokenRow = typeof refreshTokens.$inferSelect
