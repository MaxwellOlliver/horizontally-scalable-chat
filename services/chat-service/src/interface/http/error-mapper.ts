import { ZodError } from 'zod'
import { DomainError } from '../../domain/errors.js'
import { UnauthorizedError } from './auth-context.js'

export interface HttpError {
  status: number
  body: { error: string; message: string }
}

/**
 * Maps domain / auth / validation errors to HTTP responses for the history
 * endpoint. Anything unrecognised becomes a generic 500 (and is logged).
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: { error: 'VALIDATION_ERROR', message: 'Request validation failed' },
    }
  }

  if (err instanceof UnauthorizedError) {
    return { status: 401, body: { error: err.code, message: err.message } }
  }

  if (err instanceof DomainError) {
    return { status: statusForCode(err.code), body: { error: err.code, message: err.message } }
  }

  console.error('[chat] unhandled error', err)
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Internal server error' } }
}

function statusForCode(code: string): number {
  switch (code) {
    case 'CONVERSATION_NOT_FOUND': // AC-H3
      return 404
    case 'NOT_PARTICIPANT': // AC-H3
      return 403
    default:
      return 400
  }
}
