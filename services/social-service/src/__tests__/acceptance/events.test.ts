import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Integration events emitted to the bus — AC-E1..E4. */
describe('Integration events', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser

  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
  })

  async function send(from: TestUser, to: TestUser): Promise<string> {
    const res = await h.request('POST', '/social/friends/requests', {
      token: from.token,
      body: { addresseeId: to.id },
    })
    return res.body.requestId
  }

  /** Makes a and b friends via the full send→accept flow. */
  async function befriend(from: TestUser, to: TestUser): Promise<void> {
    const id = await send(from, to)
    await h.request('POST', `/social/friends/requests/${id}/accept`, { token: to.token })
  }

  it('AC-E1: emits friend_request.created on send, identifying requester and addressee', async () => {
    await send(a, b)

    expect(h.events.events).toHaveLength(1)
    expect(h.events.events[0]).toMatchObject({
      type: 'friend_request.created',
      requesterId: a.id,
      addresseeId: b.id,
    })
  })

  it('AC-E2: emits friend_request.accepted on accept, identifying both users', async () => {
    const id = await send(a, b)
    h.events.events.length = 0 // drop the created event

    await h.request('POST', `/social/friends/requests/${id}/accept`, { token: b.token })

    expect(h.events.events).toHaveLength(1)
    expect(h.events.events[0]).toMatchObject({
      type: 'friend_request.accepted',
      requesterId: a.id,
      addresseeId: b.id,
    })
  })

  it('AC-E3: emits no event on rejection', async () => {
    const id = await send(a, b)
    h.events.events.length = 0

    await h.request('POST', `/social/friends/requests/${id}/reject`, { token: b.token })

    expect(h.events.events).toHaveLength(0)
  })

  it('AC-E4: emits friendship.removed on un-friend, carrying the pair and remover', async () => {
    await befriend(a, b)
    h.events.events.length = 0 // drop created + accepted

    await h.request('DELETE', `/social/friends/${b.id}`, { token: a.token })

    expect(h.events.events).toHaveLength(1)
    const event = h.events.events[0]
    expect(event.type).toBe('friendship.removed')
    expect(event).toMatchObject({ removedBy: a.id })
    // The canonical pair is present regardless of who removed it.
    if (event.type === 'friendship.removed') {
      expect(new Set([event.userA, event.userB])).toEqual(new Set([a.id, b.id]))
    }
  })

  it('AC-E5: events carry a unique eventId and an ISO occurredAt timestamp', async () => {
    const id = await send(a, b)
    await h.request('POST', `/social/friends/requests/${id}/accept`, { token: b.token })

    expect(h.events.events).toHaveLength(2)
    const ids = h.events.events.map((e) => e.eventId)
    expect(ids.every((x) => typeof x === 'string' && x.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length) // unique ⇒ dedupable / orderable
    for (const e of h.events.events) {
      expect(e.occurredAt).toBe(new Date(e.occurredAt).toISOString())
    }
  })
})
