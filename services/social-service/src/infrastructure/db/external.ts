import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

/**
 * READ-ONLY view of auth-service's `users` table (shared DB) — only the columns
 * social-service's directory needs. Deliberately NOT in `schema.ts`, so
 * drizzle-kit never tries to create or own it. `email` is citext in the real
 * schema, so equality comparisons are case-insensitive.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
})
