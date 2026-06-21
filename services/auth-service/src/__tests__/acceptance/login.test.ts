import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/** Login — AC-L1..L3. */
describe('Login', () => {
  let h: Harness
  const creds = { email: 'login@example.com', password: 'a-strong-password' }

  beforeEach(async () => {
    h = buildHarness()
    await h.request('POST', '/auth/register', { ...creds, displayName: 'Login User' })
  })

  it('AC-L1: valid credentials return access + refresh tokens and 200', async () => {
    const res = await h.request('POST', '/auth/login', creds)
    expect(res.status).toBe(200)
    expect(typeof res.body.accessToken).toBe('string')
    expect(typeof res.body.refreshToken).toBe('string')
    expect(res.body.expiresIn).toBe(600)
  })

  it('AC-L2: unknown email and wrong password both 401 with the SAME generic message', async () => {
    const unknown = await h.request('POST', '/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever-long-enough',
    })
    const wrong = await h.request('POST', '/auth/login', {
      email: creds.email,
      password: 'wrong-but-long-enough',
    })

    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    // No field-level disclosure: the two failures are byte-for-byte identical,
    // so the response cannot reveal WHICH field was wrong (no enumeration).
    expect(unknown.body).toEqual(wrong.body)
    expect(unknown.body.error).toBe('INVALID_CREDENTIALS')
  })

  it('AC-L3: the access token carries the user id + expiry and verifies without a DB lookup', async () => {
    const login = await h.request('POST', '/auth/login', creds)
    // Verified purely from the token + shared secret — no repository involved.
    const claims = await h.tokenIssuer.verifyAccessToken(login.body.accessToken)
    const user = await h.users.findByEmail(creds.email)
    expect(claims.sub).toBe(user!.id)
    expect(claims.exp).toBeGreaterThan(claims.iat)
    expect(typeof claims.jti).toBe('string')
  })
})
