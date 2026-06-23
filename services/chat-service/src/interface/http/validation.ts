import { z } from 'zod'

/** Path param for the conversation whose history is requested. */
export const conversationIdSchema = z.string().uuid()

/** Path param for the friend whose conversation is being resolved/opened. */
export const friendIdSchema = z.string().uuid()

/** Query params for history pagination (AC-H1). A parse failure maps to 422. */
export const historyQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})
