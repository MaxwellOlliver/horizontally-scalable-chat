import { describe, expect, it } from 'vitest'
import { buildHarness } from './support/harness.js'

describe('smoke', () => {
  it('health endpoint responds', async () => {
    const { request } = buildHarness()
    const res = await request('GET', '/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'social-service' })
  })

  it('send returns 201 and a pending request id', async () => {
    const h = buildHarness()
    const a = await h.createUser()
    const b = await h.createUser()
    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { addresseeId: b.id },
    })
    expect(res.status).toBe(201)
    expect(typeof res.body.requestId).toBe('string')
    expect(res.body.status).toBe('pending')
  })

  it('lists friends (empty) for an authenticated user', async () => {
    const h = buildHarness()
    const a = await h.createUser()
    const res = await h.request('GET', '/social/friends', { token: a.token })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
