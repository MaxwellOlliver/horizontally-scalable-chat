import { z } from 'zod'

/**
 * Send-request body: the addressee is identified by email (the handle a user
 * actually knows), resolved to an id server-side. A parse failure maps to 422.
 */
export const sendRequestSchema = z.object({
  email: z.string().email(),
})

export const requestIdSchema = z.string().uuid()

/** Path param for the friend to un-friend (`DELETE /friends/{userId}`). */
export const userIdSchema = z.string().uuid()

export const directionSchema = z.enum(['incoming', 'outgoing'])
