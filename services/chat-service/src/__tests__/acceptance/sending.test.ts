import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH } from '../../domain/message.js'
import { buildHarness, type Harness, type TestUser } from '../support/harness.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Sending — AC-M1..M5, AC-O1. */
describe('Sending', () => {
  let h: Harness
  let a: TestUser
  let b: TestUser
  beforeEach(async () => {
    h = buildHarness()
    a = await h.createUser()
    b = await h.createUser()
    await h.acceptFriends(a.id, b.id)
  })

  it('AC-M1: persists with a server UUIDv7 + timestamp and acks the sender', async () => {
    await h.send({ clientMsgId: 'c1', senderId: a.id, toUserId: b.id, body: 'hello' })

    expect(h.messages.rows).toHaveLength(1)
    const stored = h.messages.rows[0]!
    expect(stored.id).toMatch(UUID_RE)
    expect(stored.body).toBe('hello')
    expect(stored.createdAt).toBeInstanceOf(Date)

    const ack = h.outbound.to(a.id).find((f) => f.type === 'message.sent')
    expect(ack).toBeDefined()
    expect(ack!.data.id).toBe(stored.id) // canonical id (AC-M1)
    expect(ack!.data.clientMsgId).toBe('c1') // correlation (AC-M3)
    expect(ack!.data.createdAt).toBe(stored.createdAt.toISOString())
  })

  it('AC-O1: the server assigns the canonical id; the client id is not the message id', async () => {
    await h.send({ clientMsgId: 'not-a-uuid', senderId: a.id, toUserId: b.id, body: 'hi' })
    const stored = h.messages.rows[0]!
    expect(stored.id).not.toBe('not-a-uuid')
    expect(stored.id).toMatch(UUID_RE)
    expect(stored.clientMsgId).toBe('not-a-uuid')
  })

  it('AC-M4: a retry with the same clientMsgId does not duplicate and re-acks the original id', async () => {
    await h.send({ clientMsgId: 'dup', senderId: a.id, toUserId: b.id, body: 'once' })
    const firstId = h.messages.rows[0]!.id

    await h.send({ clientMsgId: 'dup', senderId: a.id, toUserId: b.id, body: 'once' })

    expect(h.messages.rows).toHaveLength(1)
    const acks = h.outbound.to(a.id).filter((f) => f.type === 'message.sent')
    expect(acks).toHaveLength(2)
    expect(acks.every((ack) => ack.data.id === firstId)).toBe(true)
  })

  it('AC-M2: a send to a non-friend is rejected and not persisted', async () => {
    const stranger = await h.createUser()
    await h.send({ clientMsgId: 'x', senderId: a.id, toUserId: stranger.id, body: 'hi' })

    expect(h.messages.rows).toHaveLength(0)
    const rejection = h.outbound.to(a.id).find((f) => f.type === 'message.rejected')
    expect(rejection?.data.reason).toBe('NOT_FRIENDS')
    expect(rejection?.data.clientMsgId).toBe('x')
    // Nothing pushed to the would-be recipient.
    expect(h.outbound.to(stranger.id)).toHaveLength(0)
  })

  it('AC-M5: an empty / whitespace-only body is rejected', async () => {
    await h.send({ clientMsgId: 'e', senderId: a.id, toUserId: b.id, body: '   ' })
    expect(h.messages.rows).toHaveLength(0)
    const rejection = h.outbound.to(a.id).find((f) => f.type === 'message.rejected')
    expect(rejection?.data.reason).toBe('EMPTY_MESSAGE')
  })

  it('AC-M5: an oversized body is rejected', async () => {
    const tooLong = 'x'.repeat(MAX_MESSAGE_LENGTH + 1)
    await h.send({ clientMsgId: 'o', senderId: a.id, toUserId: b.id, body: tooLong })
    expect(h.messages.rows).toHaveLength(0)
    const rejection = h.outbound.to(a.id).find((f) => f.type === 'message.rejected')
    expect(rejection?.data.reason).toBe('MESSAGE_TOO_LONG')
  })

  it('a malformed envelope is dropped without persisting or throwing', async () => {
    // Missing toUserId / not a uuid — the worker drops it (acked), no crash.
    await h.send({ clientMsgId: 'm', senderId: a.id, toUserId: 'nope', body: 'hi' })
    expect(h.messages.rows).toHaveLength(0)
  })
})
