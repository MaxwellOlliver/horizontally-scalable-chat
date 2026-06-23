import { Elysia } from 'elysia'
import type { LogEmitter } from '@hsc/platform'
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
export function createAuthRoutes(useCases: AuthUseCases, logger: LogEmitter) {
  return new Elysia({ prefix: '/auth' })
    .post('/register', async ({ body, set }) => {
      try {
        const input = registerSchema.parse(body)
        const { userId } = await useCases.registerUser.execute(input)
        logger.emit(userId, 'User registered')
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
        emitFor(logger, tokens.accessToken, 'Login')
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
        emitFor(logger, tokens.accessToken, 'Token refresh')
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

/** Emits a log line for the subject of a freshly-minted access token. The token
 * is our own and already verified upstream, so reading its `sub` is safe here. */
function emitFor(logger: LogEmitter, accessToken: string, event: string) {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return
    const sub = JSON.parse(Buffer.from(payload, 'base64url').toString()).sub
    if (typeof sub === 'string') logger.emit(sub, event)
  } catch {
    // A malformed token here would be a bug, not user input — never break the
    // response over a log line.
  }
}
