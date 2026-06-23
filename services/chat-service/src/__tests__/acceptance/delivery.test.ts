import { beforeEach, describe, expect, it } from 'vitest'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'
import { FailingOutboundPublisher } from '../support/fakes.js'

/** Real-time receive — AC-D1, AC-D2, AC-D3. */
describe('Delivery', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
    await h.acceptFriends(a.id, b.id)
  })

  it('AC-D1: the message is pushed to the recipient', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'yo' })

    const received = h.outbound.to(b.id).filter((f) => f.type === 'message.received')
    expect(received).toHaveLength(1)
    expect(received[0]!.data.body).toBe('yo')
    expect(received[0]!.data.senderId).toBe(a.id)
  })

  it('AC-D3: the message is echoed to the sender (their other devices) alongside the ack', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'yo' })

    const toSender = h.outbound.to(a.id)
    expect(toSender.some((f) => f.type === 'message.sent')).toBe(true) // ack (AC-M1)
    expect(toSender.some((f) => f.type === 'message.received')).toBe(true) // echo (AC-D3)
  })

  it('AC-D2: an offline recipient gets no push but the message is persisted (retrievable via history)', async () => {
    // Every push fails -> models offline / Redis down. The send must still commit.
    const offline = buildHarness({ outbound: new FailingOutboundPublisher() })
    const x = await offline.createUser()
    const y = await offline.createUser()
    await offline.acceptFriends(x.id, y.id)

    await offline.send({ clientMsgId: 'c1', senderId: x.id, toUserId: y.id, body: 'stored' })

    expect(offline.messages.rows).toHaveLength(1)
    expect(offline.messages.rows[0]!.body).toBe('stored')
  })
})
