import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Removing a friend (un-friend) — AC-U1..U3. */
describe('Removing a friend', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser

  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
  })

  async function befriend(from: TestUser, to: TestUser): Promise<void> {
    const sent = await h.request('POST', '/social/friends/requests', {
      token: from.token,
      body: { email: to.email },
    })
    await h.request('POST', `/social/friends/requests/${sent.body.requestId}/accept`, {
      token: to.token,
    })
  }

  it('AC-U1: the requester (a party) can remove the friendship → 204, friendship gone', async () => {
    await befriend(a, b)

    const res = await h.request('DELETE', `/social/friends/${b.id}`, { token: a.token })

    expect(res.status).toBe(204)
    expect(await h.friendships.areFriends(a.id, b.id)).toBe(false)
    expect(h.friendships.size).toBe(0)
  })

  it('AC-U1: the addressee (the other party) can equally remove the friendship', async () => {
    await befriend(a, b)

    // b was the addressee of the original request; it can still remove.
    const res = await h.request('DELETE', `/social/friends/${a.id}`, { token: b.token })

    expect(res.status).toBe(204)
    expect(await h.friendships.areFriends(a.id, b.id)).toBe(false)
  })

  it('AC-U2: removing when no friendship exists is a no-op returning 404', async () => {
    const res = await h.request('DELETE', `/social/friends/${b.id}`, { token: a.token })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('FRIENDSHIP_NOT_FOUND')
    // No event, no push for a no-op removal.
    expect(h.events.events).toHaveLength(0)
    expect(h.livePush.frames).toHaveLength(0)
  })

  it('AC-U3: after removal, the two users may re-friend', async () => {
    await befriend(a, b)
    await h.request('DELETE', `/social/friends/${b.id}`, { token: a.token })

    // A fresh request is allowed (not blocked by the historical accepted row).
    const res = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')

    // And it can be accepted back into a friendship.
    const accept = await h.request(
      'POST',
      `/social/friends/requests/${res.body.requestId}/accept`,
      {
        token: b.token,
      },
    )
    expect(accept.status).toBe(200)
    expect(await h.friendships.areFriends(a.id, b.id)).toBe(true)
  })

  it('requires authentication (401)', async () => {
    await befriend(a, b)
    const res = await h.request('DELETE', `/social/friends/${b.id}`)
    expect(res.status).toBe(401)
    expect(await h.friendships.areFriends(a.id, b.id)).toBe(true)
  })
})
