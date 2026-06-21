import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/** Logout — AC-O1. */
describe('Logout', () => {
  let h: Harness
  const creds = { email: 'logout@example.com', password: 'a-strong-password' }
  let accessToken: string
  let refreshToken: string

  beforeEach(async () => {
    h = buildHarness()
    await h.request('POST', '/auth/register', { ...creds, displayName: 'Logout User' })
    const login = await h.request('POST', '/auth/login', creds)
    accessToken = login.body.accessToken
    refreshToken = login.body.refreshToken
  })

  it('AC-O1: logout returns 204 and revokes the refresh-token family (refresh then fails)', async () => {
    const out = await h.request('POST', '/auth/logout', { refreshToken })
    expect(out.status).toBe(204)
    expect(out.body).toBeNull()

    const refresh = await h.request('POST', '/auth/refresh', { refreshToken })
    expect(refresh.status).toBe(401)
  })

  it('AC-O1: outstanding (stateless) access tokens remain valid until natural expiry', async () => {
    await h.request('POST', '/auth/logout', { refreshToken })
    // The access token is still verifiable — revocation lives at the refresh layer.
    const claims = await h.tokenIssuer.verifyAccessToken(accessToken)
    expect(typeof claims.sub).toBe('string')
  })

  it('logout is idempotent and silent for an unknown token (still 204)', async () => {
    const res = await h.request('POST', '/auth/logout', { refreshToken: 'never-issued' })
    expect(res.status).toBe(204)
  })
})
