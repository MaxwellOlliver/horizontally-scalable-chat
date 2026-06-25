import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/** Registration — AC-R1..R4. */
describe('Registration', () => {
  let h: Harness
  beforeEach(() => {
    h = buildHarness()
  })

  const valid = {
    email: 'New.User@Example.com',
    password: 'a-strong-password',
    displayName: 'New User',
  }

  it('AC-R1: accepts a unique, policy-compliant registration, assigns an id, returns 201', async () => {
    const res = await h.request('POST', '/auth/register', valid)
    expect(res.status).toBe(201)
    expect(typeof res.body.userId).toBe('string')

    const user = h.users.rows.get(res.body.userId)
    expect(user).toBeDefined()
    // Email normalised to canonical lowercase form.
    expect(user!.email).toBe('new.user@example.com')
  })

  it('AC-R1/AC-R4: stores an Argon2id-style hash, never the plaintext password', async () => {
    const res = await h.request('POST', '/auth/register', valid)
    const user = h.users.rows.get(res.body.userId)!
    expect(user.passwordHash).not.toBe(valid.password)
    expect(user.passwordHash).not.toContain(valid.password)
  })

  it('AC-R2: rejects a duplicate email with 409 and does not create a second user', async () => {
    await h.request('POST', '/auth/register', valid)
    const res = await h.request('POST', '/auth/register', {
      ...valid,
      email: 'new.user@example.com', // same address, different case already used
      displayName: 'Imposter',
    })
    expect(res.status).toBe(409)
    expect(h.users.rows.size).toBe(1)
  })

  it('AC-R3: rejects a policy-violating (too short) password with 422 and creates no user', async () => {
    const res = await h.request('POST', '/auth/register', {
      email: 'weak@example.com',
      password: 'short',
      displayName: 'Weak',
    })
    expect(res.status).toBe(422)
    expect(h.users.rows.size).toBe(0)
  })
})
