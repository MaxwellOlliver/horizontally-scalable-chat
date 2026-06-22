import { ZodError } from 'zod'
import { DomainError } from '../../domain/errors.js'
import { UnauthorizedError } from './auth-context.js'

export interface HttpError {
  status: number
  body: { error: string; message: string }
}

/**
 * Maps domain / auth / validation errors to HTTP responses (spec §2.6).
 * Anything unrecognised becomes a generic 500.
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

  // Unrecognised => unexpected (bug, DB/infra failure). The client gets a safe
  // generic 500, but we MUST log the cause server-side — otherwise it's invisible.
  console.error('[social] unhandled error', err)
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Internal server error' } }
}

function statusForCode(code: string): number {
  switch (code) {
    case 'SELF_REQUEST':
      return 422 // AC-S2
    case 'ALREADY_FRIENDS': // AC-S3
    case 'DUPLICATE_REQUEST': // AC-S4
    case 'REQUEST_NOT_PENDING': // AC-R4
      return 409
    case 'ADDRESSEE_NOT_FOUND': // AC-S6
    case 'REQUEST_NOT_FOUND':
    case 'FRIENDSHIP_NOT_FOUND': // AC-U2
      return 404
    case 'NOT_ADDRESSEE': // AC-R3
      return 403
    default:
      return 400
  }
}
