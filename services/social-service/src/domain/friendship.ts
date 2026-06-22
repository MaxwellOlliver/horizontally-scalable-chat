/**
 * Friendship (spec §2.2): symmetric, unique per pair (AC-F1). Stored in
 * canonical order so the unordered pair {x, y} has exactly one representation.
 */
export interface Friendship {
  readonly id: string
  readonly userA: string
  readonly userB: string
  readonly createdAt: Date
}

/**
 * Orders two user ids canonically (userA < userB) so a pair maps to a single
 * row regardless of who requested. UUIDs compare lexicographically.
 */
export function canonicalPair(x: string, y: string): { userA: string; userB: string } {
  return x < y ? { userA: x, userB: y } : { userA: y, userB: x }
}
