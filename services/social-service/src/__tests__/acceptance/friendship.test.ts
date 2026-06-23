import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Friendship & gating, and the durable lists — AC-F1, AC-F2, AC-F3. */
describe('Friendship & lists', () => {
  let h: Harness
  beforeEach(() => {
    h = buildHarness()
  })

  /** Makes a and b friends via the full send→accept flow. */
  async function befriend(a: TestUser, b: TestUser): Promise<void> {
    const sent = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    await h.request('POST', `/social/friends/requests/${sent.body.requestId}/accept`, { token: b.token })
  }

  it('AC-F1: a friendship is symmetric and unique per pair regardless of requester', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    await befriend(a, b)

    expect(await h.friendships.areFriends(a.id, b.id)).toBe(true)
    expect(await h.friendships.areFriends(b.id, a.id)).toBe(true)
    expect(h.friendships.size).toBe(1)
  })

  it('AC-F2: exposes an "are X and Y friends?" check', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    const stranger = await h.createUser()

    const before = await h.request('GET', `/social/friends/${b.id}/status`, { token: a.token })
    expect(before.status).toBe(200)
    expect(before.body.areFriends).toBe(false)

    await befriend(a, b)

    const after = await h.request('GET', `/social/friends/${b.id}/status`, { token: a.token })
    expect(after.body.areFriends).toBe(true)

    const unrelated = await h.request('GET', `/social/friends/${stranger.id}/status`, { token: a.token })
    expect(unrelated.body.areFriends).toBe(false)
  })

  it('AC-F3: lists friends', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    await befriend(a, b)

    const mine = await h.request('GET', '/social/friends', { token: a.token })
    expect(mine.status).toBe(200)
    expect(mine.body).toHaveLength(1)
    expect(mine.body[0].userId).toBe(b.id)

    // Symmetric: b sees a too.
    const theirs = await h.request('GET', '/social/friends', { token: b.token })
    expect(theirs.body[0].userId).toBe(a.id)
  })

  it('AC-F3: lists incoming and outgoing pending requests independently', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    await h.request('POST', '/social/friends/requests', { token: a.token, body: { email: b.email } })

    const outgoing = await h.request('GET', '/social/friends/requests?direction=outgoing', {
      token: a.token,
    })
    expect(outgoing.status).toBe(200)
    expect(outgoing.body).toHaveLength(1)
    expect(outgoing.body[0]).toMatchObject({ requesterId: a.id, addresseeId: b.id })

    const incoming = await h.request('GET', '/social/friends/requests?direction=incoming', {
      token: b.token,
    })
    expect(incoming.body).toHaveLength(1)
    expect(incoming.body[0]).toMatchObject({ requesterId: a.id, addresseeId: b.id })

    // The requester has nothing incoming; the addressee nothing outgoing.
    const aIncoming = await h.request('GET', '/social/friends/requests?direction=incoming', {
      token: a.token,
    })
    expect(aIncoming.body).toEqual([])
  })
})
