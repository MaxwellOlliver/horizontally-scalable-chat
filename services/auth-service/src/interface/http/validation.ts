import { z } from 'zod'

/**
 * Request body schemas (spec §2.6). These guard the transport shape only;
 * domain policy (password strength, email validity) lives in the value objects
 * so it is enforced regardless of entry point. A parse failure maps to 422.
 */
export const registerSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
})

export const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
})
