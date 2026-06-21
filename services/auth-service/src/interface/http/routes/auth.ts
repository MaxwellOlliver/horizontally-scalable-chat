import { Elysia } from 'elysia'
import type { AuthenticateUser } from '../../../application/use-cases/authenticate-user.js'
import type { RefreshSession } from '../../../application/use-cases/refresh-session.js'
import type { RegisterUser } from '../../../application/use-cases/register-user.js'
import type { RevokeSession } from '../../../application/use-cases/revoke-session.js'
import { toHttpError } from '../error-mapper.js'
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '../validation.js'

export interface AuthUseCases {
  registerUser: RegisterUser
  authenticateUser: AuthenticateUser
  refreshSession: RefreshSession
  revokeSession: RevokeSession
}

/**
 * Elysia plugin mounting the `/auth/*` endpoints (spec §2.6). Each handler:
 * validates the body with zod, runs the use case, and maps any thrown
 * domain/validation error to the documented status via `toHttpError`.
 *
 * Bodies are parsed but never logged — they carry passwords and tokens (AC-R4,
 * "do not log plaintext secrets").
 */
export function createAuthRoutes(useCases: AuthUseCases) {
  return new Elysia({ prefix: '/auth' })
    .post('/register', async ({ body, set }) => {
      try {
        const input = registerSchema.parse(body)
        const { userId } = await useCases.registerUser.execute(input)
        set.status = 201
        return { userId }
      } catch (err) {
        return fail(set, err)
      }
    })
    .post('/login', async ({ body, set }) => {
      try {
        const input = loginSchema.parse(body)
        const tokens = await useCases.authenticateUser.execute(input)
        set.status = 200
        return tokens
      } catch (err) {
        return fail(set, err)
      }
    })
    .post('/refresh', async ({ body, set }) => {
      try {
        const input = refreshSchema.parse(body)
        const tokens = await useCases.refreshSession.execute(input)
        set.status = 200
        return tokens
      } catch (err) {
        return fail(set, err)
      }
    })
    .post('/logout', async ({ body, set }) => {
      try {
        const input = logoutSchema.parse(body)
        await useCases.revokeSession.execute(input)
        set.status = 204
        return null
      } catch (err) {
        return fail(set, err)
      }
    })
}

function fail(set: { status?: number | string }, err: unknown) {
  const { status, body } = toHttpError(err)
  set.status = status
  return body
}
