import { uuidv7 } from 'uuidv7'

/** Generates server-assigned UUIDv7 ids (project convention). */
export interface IdGenerator {
  next(): string
}

/** Server-assigned, time-sortable UUIDv7 ids (project convention). */
export const uuidv7Generator: IdGenerator = {
  next: () => uuidv7(),
}
