import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'
import { FailingLivePush } from '../support/fakes.js'

/** Real-time list-update pushes to per-user channels — AC-P1..P4. */
describe('Real-time list updates', () => {
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

  it('AC-P1: pushes a frame to the addressee on send', async () => {
    const id = await send(a, b)

    expect(h.livePush.frames).toHaveLength(1)
    expect(h.livePush.frames[0]).toMatchObject({
      userId: b.id,
      frame: { type: 'friend_request.received', data: { requestId: id, requesterId: a.id } },
    })
  })

  it('AC-P2: pushes a frame to the requester on accept', async () => {
    const id = await send(a, b)
    h.livePush.frames.length = 0 // drop the received frame

    const res = await h.request('POST', `/social/friends/requests/${id}/accept`, { token: b.token })

    expect(h.livePush.frames).toHaveLength(1)
    expect(h.livePush.frames[0]).toMatchObject({
      userId: a.id,
      frame: {
        type: 'friend_request.accepted',
        data: { friendshipId: res.body.friendshipId, by: b.id },
      },
    })
  })

  it('AC-P3: pushes no frame on rejection', async () => {
    const id = await send(a, b)
    h.livePush.frames.length = 0

    await h.request('POST', `/social/friends/requests/${id}/reject`, { token: b.token })

    expect(h.livePush.frames).toHaveLength(0)
  })

  it('AC-P4: on un-friend, pushes a frame to BOTH users naming the dropped friend', async () => {
    await befriend(a, b)
    h.livePush.frames.length = 0 // drop received + accepted

    await h.request('DELETE', `/social/friends/${b.id}`, { token: a.token })

    expect(h.livePush.frames).toHaveLength(2)
    const byUser = new Map(h.livePush.frames.map((f) => [f.userId, f.frame]))
    expect(byUser.get(a.id)).toMatchObject({
      type: 'friendship.removed',
      data: { userId: b.id, by: a.id },
    })
    expect(byUser.get(b.id)).toMatchObject({
      type: 'friendship.removed',
      data: { userId: a.id, by: a.id },
    })
  })

  it('AC-P5: push is best-effort — a failed push does not fail the mutation, and the list reflects it', async () => {
    // Offline addressee: every push throws. The send must still succeed and the
    // change must be visible on the next list load (the lists are correctness).
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const offline = buildHarness({ livePush: new FailingLivePush() })
    const x = await offline.createUser()
    const y = await offline.createUser()

    const res = await offline.request('POST', '/social/friends/requests', {
      token: x.token,
      body: { addresseeId: y.id },
    })
    expect(res.status).toBe(201)
    expect(errorSpy).toHaveBeenCalled() // the push failure was swallowed, not propagated
    errorSpy.mockRestore()

    const incoming = await offline.request('GET', '/social/friends/requests?direction=incoming', {
      token: y.token,
    })
    expect(incoming.body).toHaveLength(1)
    expect(incoming.body[0].requestId).toBe(res.body.requestId)
  })
})
