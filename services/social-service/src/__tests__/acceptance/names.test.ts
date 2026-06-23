import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Display-name resolution on the friend + request lists. */
describe('Name resolution', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser('Ada')
    b = await h.createUser('Bob')
  })

  async function befriend(): Promise<void> {
    const sent = await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })
    await h.request('POST', `/social/friends/requests/${sent.body.requestId}/accept`, {
      token: b.token,
    })
  }

  it('includes display names on the friends list', async () => {
    await befriend()
    const mine = await h.request('GET', '/social/friends', { token: a.token })
    expect(mine.body[0]).toMatchObject({ userId: b.id, displayName: 'Bob' })

    const theirs = await h.request('GET', '/social/friends', { token: b.token })
    expect(theirs.body[0]).toMatchObject({ userId: a.id, displayName: 'Ada' })
  })

  it('includes the counterpart name on pending requests', async () => {
    await h.request('POST', '/social/friends/requests', {
      token: a.token,
      body: { email: b.email },
    })

    const incoming = await h.request('GET', '/social/friends/requests?direction=incoming', {
      token: b.token,
    })
    expect(incoming.body[0].otherUser).toEqual({ id: a.id, displayName: 'Ada' })

    const outgoing = await h.request('GET', '/social/friends/requests?direction=outgoing', {
      token: a.token,
    })
    expect(outgoing.body[0].otherUser).toEqual({ id: b.id, displayName: 'Bob' })
  })
})
