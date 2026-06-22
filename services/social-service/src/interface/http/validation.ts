import { z } from 'zod'

/** Request validation (spec §2.6). A parse failure maps to 422. */
export const sendRequestSchema = z.object({
  addresseeId: z.string().uuid(),
})

export const requestIdSchema = z.string().uuid()

/** Path param for the friend to un-friend (`DELETE /friends/{userId}`). */
export const userIdSchema = z.string().uuid()

export const directionSchema = z.enum(['incoming', 'outgoing'])
