/** A user's display profile, for labeling conversation participants. */
export interface UserProfile {
  id: string
  displayName: string
}

/**
 * Resolves display names for user ids. chat-service stores participants as bare
 * uuids; the conversation list needs names, which live in the auth-owned `users`
 * table (read-only here — the same shared-DB read social-service does for its
 * directory). Missing ids are simply omitted.
 */
export interface UserDirectory {
  listProfiles(ids: string[]): Promise<UserProfile[]>
}
