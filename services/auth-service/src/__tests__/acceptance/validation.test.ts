import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/** Transport-shape validation (zod) maps to 422 (spec §2.6). */
describe('Request validation', () => {
  let h: Harness
  beforeEach(() => {
    h = buildHarness()
  })

  it('rejects a malformed register body (missing displayName) with 422', async () => {
    const res = await h.request('POST', '/auth/register', { email: 'a@b.com', password: 'longenough1' })
    expect(res.status).toBe(422)
  })

  it('rejects a refresh with an empty token with 422', async () => {
    const res = await h.request('POST', '/auth/refresh', { refreshToken: '' })
    expect(res.status).toBe(422)
  })
})
