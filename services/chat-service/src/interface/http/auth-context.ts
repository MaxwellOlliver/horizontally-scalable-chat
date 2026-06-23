import type { AccessTokenVerifier } from '@hsc/platform'

/** Raised when a request lacks a valid Bearer access token (mapped to 401). */
export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED'
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * Resolves the authenticated caller from the Authorization header. History reads
 * are scoped to this user (only a participant may read — AC-H3).
 */
export async function requireUser(
  authorization: string | undefined,
  verifier: AccessTokenVerifier,
): Promise<string> {
  const token = bearer(authorization)
  if (!token) {
    throw new UnauthorizedError()
  }
  try {
    const { userId } = await verifier.verify(token)
    return userId
  } catch {
    throw new UnauthorizedError('Invalid or expired access token')
  }
}

function bearer(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null
  return value
}
