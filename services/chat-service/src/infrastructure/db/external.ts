import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

/**
 * A READ-ONLY view of auth-service's `users` table (shared DB) — just the
 * columns chat-service needs to label conversation participants. This is
 * deliberately NOT in `schema.ts`, so drizzle-kit never tries to create or own
 * it; auth-service is its sole owner. chat-service only ever SELECTs from it.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
})
