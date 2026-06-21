import { describe, expect, it } from 'vitest'
import { buildHarness } from './support/harness.js'

describe('smoke', () => {
  it('health endpoint responds', async () => {
    const { request } = buildHarness()
    const res = await request('GET', '/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'auth-service' })
  })

  it('register returns 201 and a userId', async () => {
    const { request } = buildHarness()
    const res = await request('POST', '/auth/register', {
      email: 'a@b.com',
      password: 'correct horse battery',
      displayName: 'A',
    })
    expect(res.status).toBe(201)
    expect(typeof res.body.userId).toBe('string')
  })
})
