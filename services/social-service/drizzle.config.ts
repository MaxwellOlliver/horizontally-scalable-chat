import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/db/schema.ts',
  out: './src/infrastructure/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/hsc',
  },
  casing: 'snake_case',
  // All services migrate into the same DB; isolate the bookkeeping table so
  // drizzle-kit doesn't skip this service's migrations by another's timestamp.
  migrations: { table: 'social_migrations' },
})
