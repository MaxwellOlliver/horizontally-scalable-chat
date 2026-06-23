import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness } from '../support/harness.js'

/**
 * Observability log stream: a friend action logs to BOTH parties — the actor and
 * the counterparty — so each side sees that an instance handled it (e.g. the
 * requester is notified when their request is accepted).
 */
describe('Logging', () => {
  let h: Harness
  beforeEach(() => {
    h = buildHarness()
  })

  it('logs a sent request to the requester and a received to the addressee', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    await h.request('POST', '/social/friends/requests', { token: a.token, body: { email: b.email } })
    expect(h.logs).toContainEqual({ userIds: [a.id], event: 'Friend request sent' })
    expect(h.logs).toContainEqual({ userIds: [b.id], event: 'Friend request received' })
  })

  it('logs an accept to BOTH the accepter and the original requester', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    const sent = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    await h.request('POST', `/social/friends/requests/${sent.body.requestId}/accept`, {
      token: b.token,
    })
    // b accepted; a (the requester) must be notified — the reported gap.
    expect(h.logs).toContainEqual({ userIds: [b.id], event: 'Friend request accepted' })
    expect(h.logs).toContainEqual({ userIds: [a.id], event: 'Friend request accepted' })
  })

  it('logs a removal to both former friends', async () => {
    const a = await h.createUser()
    const b = await h.createUser()
    const sent = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    await h.request('POST', `/social/friends/requests/${sent.body.requestId}/accept`, { token: b.token })
    await h.request('DELETE', `/social/friends/${b.id}`, { token: a.token })
    expect(h.logs).toContainEqual({ userIds: [a.id], event: 'Friend removed' })
    expect(h.logs).toContainEqual({ userIds: [b.id], event: 'Friend removed' })
  })

  it('does not log when the action fails (request to yourself)', async () => {
    const a = await h.createUser()
    await h.request('POST', '/social/friends/requests', { token: a.token, body: { email: a.email } })
    expect(h.logs).toHaveLength(0)
  })
})
