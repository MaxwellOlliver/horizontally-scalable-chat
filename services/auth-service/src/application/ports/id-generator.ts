/** Generates server-assigned UUIDv7 ids (project convention). */
export interface IdGenerator {
  next(): string
}
