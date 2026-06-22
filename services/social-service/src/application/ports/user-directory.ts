/**
 * Existence check for users owned by the auth-service (AC-S6). social-service
 * does not own the users table, so this is a read-only directory lookup rather
 * than a foreign key.
 */
export interface UserDirectory {
  exists(userId: string): Promise<boolean>
}
