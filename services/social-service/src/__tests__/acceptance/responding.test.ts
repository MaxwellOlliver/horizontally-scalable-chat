import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Responding to a friend request — AC-R1..R5. */
describe('Responding to a friend request', () => {
  let h: Harness
  let requester: TestUser
  let addressee: TestUser

  beforeEach(async () => {
    h = buildHarness()
    requester = await h.createUser()
    addressee = await h.createUser()
  })

  /** requester → addressee, returns the pending request id. */
  async function sendPending(): Promise<string> {
    const res = await h.request('POST', '/social/friends/requests', {
      token: requester.token,
      body: { email: addressee.email },
    })
    return res.body.requestId
  }

  it('AC-R1: the addressee accepts, creating a symmetric friendship', async () => {
    const id = await sendPending()

    const res = await h.request('POST', `/social/friends/requests/${id}/accept`, {
      token: addressee.token,
    })

    expect(res.status).toBe(200)
    expect(typeof res.body.friendshipId).toBe('string')
    expect(h.friendRequests.rows.get(id)!.status).toBe('accepted')
    expect(await h.friendships.areFriends(requester.id, addressee.id)).toBe(true)
  })

  it('AC-R2: the addressee rejects, marking it rejected with no friendship', async () => {
    const id = await sendPending()

    const res = await h.request('POST', `/social/friends/requests/${id}/reject`, {
      token: addressee.token,
    })

    expect(res.status).toBe(204)
    expect(h.friendRequests.rows.get(id)!.status).toBe('rejected')
    expect(h.friendships.size).toBe(0)
  })

  it('AC-R3: anyone other than the addressee gets 403 (accept and reject)', async () => {
    const id = await sendPending()
    const intruder = await h.createUser()

    const accept = await h.request('POST', `/social/friends/requests/${id}/accept`, {
      token: intruder.token,
    })
    expect(accept.status).toBe(403)
    expect(accept.body.error).toBe('NOT_ADDRESSEE')

    // The requester is also not the addressee.
    const reject = await h.request('POST', `/social/friends/requests/${id}/reject`, {
      token: requester.token,
    })
    expect(reject.status).toBe(403)

    expect(h.friendRequests.rows.get(id)!.status).toBe('pending')
  })

  it('AC-R4: responding to a non-pending request returns 409', async () => {
    const id = await sendPending()
    await h.request('POST', `/social/friends/requests/${id}/accept`, { token: addressee.token })

    // Second accept: no longer pending.
    const reAccept = await h.request('POST', `/social/friends/requests/${id}/accept`, {
      token: addressee.token,
    })
    expect(reAccept.status).toBe(409)
    expect(reAccept.body.error).toBe('REQUEST_NOT_PENDING')

    // Reject after accept: also 409.
    const reReject = await h.request('POST', `/social/friends/requests/${id}/reject`, {
      token: addressee.token,
    })
    expect(reReject.status).toBe(409)
  })

  it('AC-R5: two racing accepts produce exactly one friendship', async () => {
    const id = await sendPending()

    const [first, second] = await Promise.all([
      h.request('POST', `/social/friends/requests/${id}/accept`, { token: addressee.token }),
      h.request('POST', `/social/friends/requests/${id}/accept`, { token: addressee.token }),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    expect(h.friendships.size).toBe(1)
  })

  it('accept/reject of a non-existent request returns 404', async () => {
    const missing = '22222222-2222-7222-8222-222222222222'
    const res = await h.request('POST', `/social/friends/requests/${missing}/accept`, {
      token: addressee.token,
    })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('REQUEST_NOT_FOUND')
  })
})
