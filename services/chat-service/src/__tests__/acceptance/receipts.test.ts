import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

/** Delivery & read receipts — high-water marks (REQUIREMENTS §4). */
describe('Receipts', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser('Ada')
    b = await h.createUser('Bob')
    await h.acceptFriends(a.id, b.id)
  })

  /** a→b message; returns its canonical id + conversationId. */
  async function sendFromA(clientMsgId: string, body: string) {
    await h.send({ clientMsgId, senderId: a.id, toUserId: b.id, body })
    const ack = h.outbound.to(a.id).findLast((f) => f.type === 'message.sent')!
    return { id: ack.data.id as string, conversationId: ack.data.conversationId as string }
  }

  it('a read receipt advances both pointers and pushes receipt.update to the sender', async () => {
    const { id, conversationId } = await sendFromA('c1', 'hi')

    // Bob reads up to the message; reading implies delivered (§4.5 invariant).
    await h.receipt({ userId: b.id, conversationId, readUpTo: id })

    const update = h.outbound.to(a.id).findLast((f) => f.type === 'receipt.update')
    expect(update).toBeDefined()
    expect(update!.data).toMatchObject({ conversationId, by: b.id, deliveredUpTo: id, readUpTo: id })
  })

  it('a delivered-only receipt does not advance read', async () => {
    const { id, conversationId } = await sendFromA('c1', 'hi')

    await h.receipt({ userId: b.id, conversationId, deliveredUpTo: id })

    const update = h.outbound.to(a.id).findLast((f) => f.type === 'receipt.update')!
    expect(update.data.deliveredUpTo).toBe(id)
    expect(update.data.readUpTo).toBeNull()
  })

  it('advancing is max() — a stale (lower) receipt cannot move a pointer back', async () => {
    const first = await sendFromA('c1', 'one')
    const second = await sendFromA('c2', 'two')

    await h.receipt({ userId: b.id, conversationId: second.conversationId, readUpTo: second.id })
    await h.receipt({ userId: b.id, conversationId: second.conversationId, readUpTo: first.id }) // stale

    const pointer = h.receipts.rows.get(`${second.conversationId}|${b.id}`)
    expect(pointer?.readUpTo).toBe(second.id)
  })

  it('GET receipts returns the conversation pointers (resync)', async () => {
    const { id, conversationId } = await sendFromA('c1', 'hi')
    await h.receipt({ userId: b.id, conversationId, readUpTo: id })

    const res = await h.request('GET', `/chat/conversations/${conversationId}/receipts`, {
      token: a.token,
    })
    expect(res.status).toBe(200)
    expect(res.body.receipts).toContainEqual({ userId: b.id, deliveredUpTo: id, readUpTo: id })
  })

  it('GET receipts is participant-only (403 for a stranger)', async () => {
    const { conversationId } = await sendFromA('c1', 'hi')
    const stranger = await h.createUser('Cleo')

    const res = await h.request('GET', `/chat/conversations/${conversationId}/receipts`, {
      token: stranger.token,
    })
    expect(res.status).toBe(403)
  })

  it('a receipt from a non-participant is ignored', async () => {
    const { id, conversationId } = await sendFromA('c1', 'hi')
    const stranger = await h.createUser('Cleo')

    await h.receipt({ userId: stranger.id, conversationId, readUpTo: id })

    expect(h.receipts.rows.has(`${conversationId}|${stranger.id}`)).toBe(false)
    expect(h.outbound.ofType('receipt.update')).toHaveLength(0)
  })
})
