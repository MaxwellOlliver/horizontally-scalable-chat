import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/** Sending a friend request — AC-S1..S7. */
describe('Sending a friend request', () => {
  let h: Harness
  beforeEach(() => {
    h = buildHarness()
  })

  it('AC-S1: creates a pending request and returns 201', async () => {
    const a = await h.createUser()
    const b = await h.createUser()

    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')
    const row = h.friendRequests.rows.get(res.body.requestId)
    expect(row).toMatchObject({ requesterId: a.id, addresseeId: b.id, status: 'pending' })
  })

  it('AC-S2: rejects a request to yourself with 422', async () => {
    const a = await h.createUser()

    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: a.email },
    })

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('SELF_REQUEST')
    expect(h.friendRequests.rows.size).toBe(0)
  })

  it('AC-S3: rejects a request when the two users are already friends with 409', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    // Seed an existing friendship in canonical order.
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id]
    await h.friendships.ensure('00000000-0000-7000-8000-0000000000ff', x, y, h.clock.now())

    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('ALREADY_FRIENDS')
  })

  it('AC-S4: rejects a duplicate pending request (same direction) with 409', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })

    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('DUPLICATE_REQUEST')
    // Only the original pending request exists.
    expect([...h.friendRequests.rows.values()].filter((r) => r.status === 'pending')).toHaveLength(
      1,
    )
  })

  it('AC-S5: a reverse pending request auto-accepts into a friendship', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    // B asks A first.
    const first = await h.request('POST', '/social/friends/requests', {
      token: b.token,
      body: { email: a.email },
    })
    // A asks B back: mutual intent ⇒ accept the existing request.
    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('accepted')
    expect(res.body.requestId).toBe(first.body.requestId)
    expect(await h.friendships.areFriends(a.id, b.id)).toBe(true)
    expect(h.friendships.size).toBe(1)
    // No second request row was created.
    expect(h.friendRequests.rows.size).toBe(1)
  })

  it('AC-S6: rejects a request to a non-existent addressee with 404', async () => {
    const a = await h.createUser()

    // A well-formed email that no user registered with.
    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: 'nobody@test.dev' },
    })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('ADDRESSEE_NOT_FOUND')
  })

  it('AC-S7: a previously rejected request does not block sending a new one', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    const first = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    // B rejects.
    const rejected = await h.request(
      'POST',
      `/social/friends/requests/${first.body.requestId}/reject`,
      {
        token: b.token,
      },
    )
    expect(rejected.status).toBe(204)

    // A may send again.
    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')
    expect(res.body.requestId).not.toBe(first.body.requestId)
  })
})
