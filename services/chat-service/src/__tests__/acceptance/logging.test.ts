import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/**
 * Observability log stream: the instance that handles a unit of work emits a
 * tagged log line to the affected user(s) (actor + counterparty). These ride the
 * same Redis → gateway path as domain frames; here we assert the handler emits
 * the right lines to the right people.
 */
describe('Logging', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
    await h.acceptFriends(a.id, b.id)
  })

  it('logs a send to the sender and a receive to the recipient', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'yo' })

    expect(h.logs).toContainEqual({ userIds: [a.id], event: 'Message sent', detail: undefined })
    expect(h.logs).toContainEqual({ userIds: [b.id], event: 'Message received', detail: undefined })
  })

  it('logs a rejection to the sender when the send is gated (not friends)', async () => {
    const stranger = await h.createUser()
    await h.send({ clientMsgId: 'c2', senderId: a.id, toUserId: stranger.id, body: 'hi' })

    const rejected = h.logs.filter((l) => l.event === 'Message rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.userIds).toEqual([a.id])
    expect(h.logs.some((l) => l.event === 'Message sent')).toBe(false)
  })

  it('logs a receipt to the user who reported it', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'yo' })
    const conversationId = h.outbound.to(b.id).find((f) => f.type === 'message.received')!.data
      .conversationId as string
    const messageId = h.outbound.to(a.id).find((f) => f.type === 'message.sent')!.data.id as string

    await h.receipt({ userId: b.id, conversationId, readUpTo: messageId })

    expect(h.logs).toContainEqual({ userIds: [b.id], event: 'Receipt recorded', detail: undefined })
  })
})
