/** A user's public-ish display profile (from the auth-owned `users` table). */
export interface UserProfile {
  id: string
  displayName: string
}

/**
 * Read-only directory over the auth-service's `users` table (AC-S6). social-service
 * shares the Postgres instance but does not own this table — there is no foreign
 * key, just lookups: email → user (to resolve a send-request addressee) and batch
 * name resolution (to label friends/requests).
 */
export interface UserDirectory {
  findByEmail(email: string): Promise<UserProfile | null>
  listProfiles(ids: string[]): Promise<UserProfile[]>
}
