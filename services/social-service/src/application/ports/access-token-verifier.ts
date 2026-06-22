/**
 * Access-token verification is a platform-standard primitive (shared HS256
 * contract with auth-service). Re-exported here so the application/interface
 * layers keep referencing the service's own ports.
 */
export { type AccessTokenVerifier, type AuthenticatedUser } from '@hsc/platform'
