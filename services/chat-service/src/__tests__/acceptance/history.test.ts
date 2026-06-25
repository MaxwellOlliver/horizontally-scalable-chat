import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** History — AC-H1, AC-H2, AC-H3. */
describe('History', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
    await h.acceptFriends(a.id, b.id)
  })

  /** Sends `bodies` in order from a→b and returns the conversation id. */
  async function seed(bodies: string[]): Promise<string> {
    for (const [i, body] of bodies.entries()) {
      await h.send({ clientMsgId: `c${i}`, senderId: a.id, toUserId: b.id, body })
    }
    const ack = h.outbound.to(a.id).find((f) => f.type === 'message.sent')
    return ack!.data.conversationId as string
  }

  it('AC-H2: returns messages most-recent-first, ordered by UUIDv7', async () => {
    const conversationId = await seed(['one', 'two', 'three'])

    const res = await h.request('GET', `/chat/conversations/${conversationId}/messages`, {
      token: a.token,
    })
    expect(res.status).toBe(200)
    expect(res.body.messages.map((m: any) => m.body)).toEqual(['three', 'two', 'one'])
    // Strictly descending by id (AC-H2).
    const ids = res.body.messages.map((m: any) => m.id)
    expect([...ids].sort((x, y) => (x < y ? 1 : -1))).toEqual(ids)
  })

  it('AC-H1: paginates by a UUIDv7 cursor', async () => {
    const conversationId = await seed(['m0', 'm1', 'm2', 'm3', 'm4'])

    const first = await h.request('GET', `/chat/conversations/${conversationId}/messages?limit=2`, {
      token: b.token,
    })
    expect(first.body.messages.map((m: any) => m.body)).toEqual(['m4', 'm3'])
    expect(first.body.nextCursor).toBe(first.body.messages[1].id)

    const second = await h.request(
      'GET',
      `/chat/conversations/${conversationId}/messages?limit=2&before=${first.body.nextCursor}`,
      { token: b.token },
    )
    expect(second.body.messages.map((m: any) => m.body)).toEqual(['m2', 'm1'])

    const third = await h.request(
      'GET',
      `/chat/conversations/${conversationId}/messages?limit=2&before=${second.body.nextCursor}`,
      { token: b.token },
    )
    expect(third.body.messages.map((m: any) => m.body)).toEqual(['m0'])
    expect(third.body.nextCursor).toBeNull() // partial page => end reached
  })

  it('AC-H3: a non-participant may not read the history', async () => {
    const conversationId = await seed(['secret'])
    const stranger = await h.createUser()

    const res = await h.request('GET', `/chat/conversations/${conversationId}/messages`, {
      token: stranger.token,
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('NOT_PARTICIPANT')
  })

  it('AC-H3: an unknown conversation is 404', async () => {
    const res = await h.request(
      'GET',
      `/chat/conversations/00000000-0000-7000-8000-0000deadbeef/messages`,
      { token: a.token },
    )
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('CONVERSATION_NOT_FOUND')
  })

  it('AC-H3: history requires authentication', async () => {
    const conversationId = await seed(['hi'])
    const res = await h.request('GET', `/chat/conversations/${conversationId}/messages`)
    expect(res.status).toBe(401)
  })
})
