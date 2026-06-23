import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Conversation list — GET /chat/conversations. */
describe('Conversation list', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser('Ada')
    b = await h.createUser('Bob')
    await h.acceptFriends(a.id, b.id)
  })

  it('requires authentication', async () => {
    const res = await h.request('GET', '/chat/conversations')
    expect(res.status).toBe(401)
  })

  it('is empty before any message is sent', async () => {
    const res = await h.request('GET', '/chat/conversations', { token: a.token })
    expect(res.status).toBe(200)
    expect(res.body.conversations).toEqual([])
  })

  it('lists a conversation with the other participant, name, and last-message preview', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hey bob' })

    const res = await h.request('GET', '/chat/conversations', { token: a.token })
    expect(res.status).toBe(200)
    expect(res.body.conversations).toHaveLength(1)

    const item = res.body.conversations[0]
    expect(item.otherUser).toEqual({ id: b.id, displayName: 'Bob' })
    expect(item.state).toBe('open')
    expect(item.lastMessage.body).toBe('hey bob')
    expect(item.lastMessage.senderId).toBe(a.id)

    // Symmetric: b sees the same conversation, labeled with Ada.
    const theirs = await h.request('GET', '/chat/conversations', { token: b.token })
    expect(theirs.body.conversations[0].otherUser.displayName).toBe('Ada')
  })

  it('orders conversations by most-recent activity', async () => {
    const c = await h.createUser('Cleo')
    await h.acceptFriends(a.id, c.id)

    await h.send({ clientMsgId: 'm1', senderId: a.id, toUserId: b.id, body: 'first to bob' })
    await h.send({ clientMsgId: 'm2', senderId: a.id, toUserId: c.id, body: 'then cleo' })
    await h.send({ clientMsgId: 'm3', senderId: a.id, toUserId: b.id, body: 'bob again — newest' })

    const res = await h.request('GET', '/chat/conversations', { token: a.token })
    const names = res.body.conversations.map((x: any) => x.otherUser.displayName)
    expect(names).toEqual(['Bob', 'Cleo'])
    expect(res.body.conversations[0].lastMessage.body).toBe('bob again — newest')
  })

  it('reflects a closed conversation after un-friend', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hi' })
    await h.removeFriends(a.id, b.id)

    const res = await h.request('GET', '/chat/conversations', { token: a.token })
    expect(res.body.conversations[0].state).toBe('closed')
  })

  describe('resolve (GET /chat/conversations/with/:friendId)', () => {
    it('returns the friend profile and null conversation before any message', async () => {
      const res = await h.request('GET', `/chat/conversations/with/${b.id}`, { token: a.token })
      expect(res.status).toBe(200)
      expect(res.body.friend).toEqual({ id: b.id, displayName: 'Bob' })
      expect(res.body.conversation).toBeNull()
    })

    it('returns the existing conversation once a message exists', async () => {
      await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hi' })
      const res = await h.request('GET', `/chat/conversations/with/${b.id}`, { token: a.token })
      expect(res.body.conversation.state).toBe('open')
      expect(typeof res.body.conversation.conversationId).toBe('string')
    })

    it('404s for an unknown user id', async () => {
      const res = await h.request('GET', '/chat/conversations/with/00000000-0000-7000-8000-0000dead0000', {
        token: a.token,
      })
      expect(res.status).toBe(404)
    })

    it('requires authentication', async () => {
      const res = await h.request('GET', `/chat/conversations/with/${b.id}`)
      expect(res.status).toBe(401)
    })
  })
})
