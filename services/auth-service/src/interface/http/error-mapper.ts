import { ZodError } from 'zod'
import { DomainError } from '../../domain/errors.js'

export interface HttpError {
  status: number
  body: { error: string; message: string }
}

/**
 * Maps domain + validation errors to HTTP responses (spec §2.6). Anything
 * unrecognised becomes a generic 500 so internal details never leak to clients.
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: { error: 'VALIDATION_ERROR', message: 'Request validation failed' },
    }
  }

  if (err instanceof DomainError) {
    return {
      status: statusForCode(err.code),
      body: { error: err.code, message: err.message },
    }
  }

  // Unrecognised => unexpected (bug, DB/infra failure). The client gets a safe
  // generic 500, but we MUST log the cause server-side — otherwise it's invisible.
  console.error('[auth] unhandled error', err)
  return {
    status: 500,
    body: { error: 'INTERNAL_ERROR', message: 'Internal server error' },
  }
}

function statusForCode(code: string): number {
  switch (code) {
    case 'EMAIL_ALREADY_IN_USE':
      return 409 // AC-R2
    case 'WEAK_PASSWORD':
    case 'INVALID_EMAIL':
      return 422 // AC-R3
    case 'INVALID_CREDENTIALS': // AC-L2
    case 'INVALID_REFRESH_TOKEN': // AC-T2 / AC-T4
      return 401
    default:
      return 400
  }
}
