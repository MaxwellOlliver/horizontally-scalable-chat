import { beforeEach, describe, expect, it } from 'vitest'
import { pairKey } from '../../domain/conversation.js'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Stable, sortable event ids so we can craft explicit orderings for LWW. */
const ev = (n: number): string => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

/** Gating & revocation — AC-G1, AC-G2, AC-G3. */
describe('Gating & revocation', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
  })

  async function lastReason(userId: string): Promise<string | undefined> {
    return h.outbound.to(userId).findLast((f) => f.type === 'message.rejected')?.data.reason as
      | string
      | undefined
  }

  it('AC-G1: friend_request.accepted builds the active read-model that gates a new conversation', async () => {
    // No friendship yet -> first send rejected.
    await h.send({ clientMsgId: 'c0', senderId: a.id, toUserId: b.id, body: 'hi' })
    expect(h.messages.rows).toHaveLength(0)
    expect(await lastReason(a.id)).toBe('NOT_FRIENDS')

    await h.acceptFriends(a.id, b.id, ev(10))
    expect(await h.friends.isActive(a.id, b.id)).toBe(true)

    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hi again' })
    expect(h.messages.rows).toHaveLength(1)
  })

  it('AC-G2: un-friend closes the conversation and subsequent sends are rejected', async () => {
    await h.acceptFriends(a.id, b.id, ev(10))
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'before' })
    expect(h.messages.rows).toHaveLength(1)

    await h.removeFriends(a.id, b.id, ev(20))

    await h.send({ clientMsgId: 'c2', senderId: a.id, toUserId: b.id, body: 'after' })
    expect(h.messages.rows).toHaveLength(1) // not persisted
    expect(await lastReason(a.id)).toBe('CONVERSATION_CLOSED')
  })

  it('AC-G3: re-friend reopens the same conversation and preserves history', async () => {
    await h.acceptFriends(a.id, b.id, ev(10))
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'before' })
    const ack = h.outbound.to(a.id).find((f) => f.type === 'message.sent')
    const conversationId = ack!.data.conversationId as string

    await h.removeFriends(a.id, b.id, ev(20))
    await h.acceptFriends(a.id, b.id, ev(30))

    await h.send({ clientMsgId: 'c2', senderId: a.id, toUserId: b.id, body: 'after' })
    expect(h.messages.rows).toHaveLength(2)

    // Same conversation; full history preserved across the un-friend/re-friend.
    const res = await h.request(
      'GET',
      `/chat/conversations/${conversationId}/messages`,
      { token: a.token },
    )
    expect(res.body.messages.map((m: any) => m.body)).toEqual(['after', 'before'])
  })

  it('AC-G1: a stale (older) removed event is ignored via last-writer-wins', async () => {
    await h.acceptFriends(a.id, b.id, ev(20)) // newer accept wins
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hi' })

    // A removed event that was delayed in flight, carrying an OLDER id.
    await h.removeFriends(a.id, b.id, ev(10))

    expect(await h.friends.isActive(a.id, b.id)).toBe(true) // unchanged
    await h.send({ clientMsgId: 'c2', senderId: a.id, toUserId: b.id, body: 'still here' })
    expect(h.messages.rows).toHaveLength(2) // send still allowed
  })

  it('AC-G1: a stale re-add cannot resurrect a removed friendship (soft-delete)', async () => {
    await h.acceptFriends(a.id, b.id, ev(10))
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hi' })
    await h.removeFriends(a.id, b.id, ev(30)) // current state: removed

    // A reordered/duplicate accept with an id older than the removal.
    await h.acceptFriends(a.id, b.id, ev(20))

    expect(await h.friends.isActive(a.id, b.id)).toBe(false) // stays removed
    expect(h.friends.rows.get(pairKey(a.id, b.id))?.lastEventId).toBe(ev(30))

    await h.send({ clientMsgId: 'c2', senderId: a.id, toUserId: b.id, body: 'after' })
    expect(await lastReason(a.id)).toBe('CONVERSATION_CLOSED')
  })

  it('AC-G1: a duplicate accepted event is idempotent', async () => {
    await h.acceptFriends(a.id, b.id, ev(10))
    await h.acceptFriends(a.id, b.id, ev(10)) // same id again
    expect(await h.friends.isActive(a.id, b.id)).toBe(true)
    expect(h.friends.rows.get(pairKey(a.id, b.id))?.lastEventId).toBe(ev(10))
  })
})
