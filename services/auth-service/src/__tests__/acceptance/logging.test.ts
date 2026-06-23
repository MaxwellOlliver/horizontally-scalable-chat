import { describe, expect, it } from 'vitest'
import { buildHarness } from '../support/harness.js'

const valid = { email: 'log@example.com', password: 'Sup3rSecret!', displayName: 'Logger' }

/**
 * Observability log stream: each auth action emits a line tagged with the
 * handling instance to the user it concerns. The user id is read back from the
 * freshly-minted access token's `sub`, which this exercises end-to-end.
 */
describe('Logging', () => {
  it('logs the new user id on register', async () => {
    const h = buildHarness()
    const res = await h.request('POST', '/auth/register', valid)
    expect(h.logs).toContainEqual({ userIds: [res.body.userId], event: 'User registered' })
  })

  it('logs a login and a token refresh against the same user id from the token sub', async () => {
    const h = buildHarness()
    const reg = await h.request('POST', '/auth/register', valid)
    const userId = reg.body.userId

    const login = await h.request('POST', '/auth/login', {
      email: valid.email,
      password: valid.password,
    })
    expect(h.logs).toContainEqual({ userIds: [userId], event: 'Login' })

    await h.request('POST', '/auth/refresh', { refreshToken: login.body.refreshToken })
    expect(h.logs).toContainEqual({ userIds: [userId], event: 'Token refresh' })
  })

  it('does not log on a failed login', async () => {
    const h = buildHarness()
    await h.request('POST', '/auth/register', valid)
    h.logs.length = 0
    await h.request('POST', '/auth/login', { email: valid.email, password: 'wrong-password' })
    expect(h.logs).toHaveLength(0)
  })
})
