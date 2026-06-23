import { describe, expect, it } from 'vitest'
import { buildHarness } from './support/harness.js'

describe('smoke', () => {
  it('health endpoint responds', async () => {
    const { request } = buildHarness()
    const res = await request('GET', '/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', service: 'chat-service' })
  })

  it('a message to a friend is persisted and acked', async () => {
    const h = buildHarness()
    const a = await h.createUser()
    const b = await h.createUser()
    await h.acceptFriends(a.id, b.id)

    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hi' })

    expect(h.messages.rows).toHaveLength(1)
    const ack = h.outbound.to(a.id).find((f) => f.type === 'message.sent')
    expect(ack?.data.clientMsgId).toBe('c1')
  })
})
