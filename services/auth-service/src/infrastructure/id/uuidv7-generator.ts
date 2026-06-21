import { uuidv7 } from 'uuidv7'
import type { IdGenerator } from '../../application/ports/id-generator.js'

/** Server-assigned, time-sortable UUIDv7 ids (project convention). */
export const uuidv7Generator: IdGenerator = {
  next: () => uuidv7(),
}
