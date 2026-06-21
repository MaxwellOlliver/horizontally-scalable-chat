import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/** Token refresh + rotation + reuse detection — AC-T1..T4. */
describe('Token refresh', () => {
  let h: Harness
  const creds = { email: 'refresh@example.com', password: 'a-strong-password' }
  let initialRefresh: string

  beforeEach(async () => {
    h = buildHarness()
    await h.request('POST', '/auth/register', { ...creds, displayName: 'Refresh User' })
    const login = await h.request('POST', '/auth/login', creds)
    initialRefresh = login.body.refreshToken
  })

  it('AC-T1: a valid refresh rotates the token (new issued, old revoked) and returns 200', async () => {
    const res = await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })
    expect(res.status).toBe(200)
    expect(typeof res.body.accessToken).toBe('string')
    expect(res.body.refreshToken).not.toBe(initialRefresh)

    // Old token is now revoked; reusing it is rejected (and is reuse-detected).
    const replay = await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })
    expect(replay.status).toBe(401)
  })

  it('AC-T3: only a HASH of each refresh token is stored, never the plaintext', async () => {
    for (const record of h.refreshTokens.rows.values()) {
      expect(record.tokenHash).not.toBe(initialRefresh)
      expect(record.tokenHash).toHaveLength(64) // sha256 hex
    }
  })

  it('AC-T2: an unknown refresh token is rejected with 401', async () => {
    const res = await h.request('POST', '/auth/refresh', { refreshToken: 'not-a-real-token' })
    expect(res.status).toBe(401)
  })

  it('AC-T2: an expired refresh token is rejected with 401', async () => {
    h.clock.advanceSeconds(1_296_000 + 1) // past the 15-day TTL
    const res = await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })
    expect(res.status).toBe(401)
  })

  it('AC-T4: replaying a used token revokes the ENTIRE family and forces re-login', async () => {
    // Rotate once: r0 -> r1 (r0 now used/revoked).
    const rotated = await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })
    const r1 = rotated.body.refreshToken

    // Replay the already-used r0 => theft signal: reject + kill the family.
    const replay = await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })
    expect(replay.status).toBe(401)

    // r1 belonged to the same family, so it is now revoked too.
    const r1Attempt = await h.request('POST', '/auth/refresh', { refreshToken: r1 })
    expect(r1Attempt.status).toBe(401)

    // Whole family is revoked in storage.
    const live = [...h.refreshTokens.rows.values()].filter((t) => t.revokedAt === null)
    expect(live).toHaveLength(0)
  })

  it('AC-T4: revoking one device family does not affect another login (separate families)', async () => {
    const otherLogin = await h.request('POST', '/auth/login', creds)
    const otherRefresh = otherLogin.body.refreshToken

    // Compromise + family-kill on the first family.
    await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })
    await h.request('POST', '/auth/refresh', { refreshToken: initialRefresh })

    // The second device's family still works.
    const stillValid = await h.request('POST', '/auth/refresh', { refreshToken: otherRefresh })
    expect(stillValid.status).toBe(200)
  })
})
