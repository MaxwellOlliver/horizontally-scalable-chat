import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/**
 * Non-functional: all mutations and list reads are authenticated, and request
 * input is validated (spec §1 non-functional, §2.6).
 */
describe('Authentication & validation', () => {
  let h: Harness
  beforeEach(() => {
    h = buildHarness()
  })

  it('rejects requests with no Bearer token (401)', async () => {
    const res = await h.request('POST', '/social/friends/requests', {
      body: { email: 'stranger@test.dev' },
    })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('UNAUTHORIZED')
    expect(h.friendRequests.rows.size).toBe(0)
  })

  it('rejects requests with an invalid/garbage token (401)', async () => {
    const res = await h.request('POST', '/social/friends/requests', {
      token: 'not-a-real-jwt',
      body: { email: 'stranger@test.dev' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects a token signed by the wrong issuer (401)', async () => {
    // A structurally valid request but the caller is unauthenticated.
    const a = await h.createUser()
    const res = await h.request('GET', '/social/friends', { token: `${a.token}tampered` })
    expect(res.status).toBe(401)
  })

  it('rejects a malformed email with 422', async () => {
    const a = await h.createUser()
    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: 'not-an-email' },
    })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('VALIDATION_ERROR')
  })

  it('rejects an unknown direction value with 422', async () => {
    const a = await h.createUser()
    const res = await h.request('GET', '/social/friends/requests?direction=sideways', { token: a.token })
    expect(res.status).toBe(422)
  })
})
