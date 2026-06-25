import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { createJwtAccessTokenVerifier } from '../jwt.js'
import { systemClock } from '../clock.js'
import { uuidv7Generator } from '../id-generator.js'
import { userChannel } from '../redis.js'
import { createLogger, logChannel, type LogFrame } from '../logging.js'

const SECRET = 'test-secret-test-secret-test-secret-123'
const ISSUER = 'hsc-auth-test'
const key = new TextEncoder().encode(SECRET)

function mint(claims: { sub?: string; issuer?: string } = {}): Promise<string> {
  let jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setExpirationTime('10m')
  if (claims.sub !== undefined) jwt = jwt.setSubject(claims.sub)
  jwt = jwt.setIssuer(claims.issuer ?? ISSUER)
  return jwt.sign(key)
}

describe('systemClock', () => {
  it('returns a Date close to now', () => {
    const before = Date.now()
    const t = systemClock.now().getTime()
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(Date.now())
  })
})

describe('uuidv7Generator', () => {
  it('produces unique, sortable, UUID-shaped ids', () => {
    const a = uuidv7Generator.next()
    const b = uuidv7Generator.next()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
    expect(a < b).toBe(true) // time-ordered
  })
})

describe('userChannel', () => {
  it('formats the per-user channel name', () => {
    expect(userChannel('abc')).toBe('user:abc')
  })
})

describe('logChannel', () => {
  it('formats the per-user log channel name, distinct from the delivery channel', () => {
    expect(logChannel('abc')).toBe('logs:abc')
    expect(logChannel('abc')).not.toBe(userChannel('abc'))
  })
})

describe('createLogger', () => {
  const at = new Date('2026-06-23T15:00:00.000Z')
  function setup() {
    const calls: Array<{ channel: string; message: LogFrame }> = []
    const logger = createLogger({
      instanceId: 'chat-service-a3f1',
      source: 'chat-service',
      publish: async (channel, message) => {
        calls.push({ channel, message: message as LogFrame })
      },
      now: () => at,
    })
    return { calls, logger }
  }

  it('emits a tagged log frame to a single user channel', () => {
    const { calls, logger } = setup()
    logger.emit('user-1', 'Message sent')
    expect(calls).toHaveLength(1)
    expect(calls[0].channel).toBe('logs:user-1')
    expect(calls[0].message).toEqual({
      type: 'log',
      data: {
        instance: 'chat-service-a3f1',
        source: 'chat-service',
        event: 'Message sent',
        at: at.toISOString(),
      },
    })
  })

  it('fans out to every distinct user, deduping repeats (actor === counterparty)', () => {
    const { calls, logger } = setup()
    logger.emit(['user-1', 'user-2', 'user-1'], 'Message sent')
    expect(calls.map((c) => c.channel).sort()).toEqual(['logs:user-1', 'logs:user-2'])
  })

  it('includes optional detail when given', () => {
    const { calls, logger } = setup()
    logger.emit('user-1', 'Receipt recorded', { conversationId: 'c-9' })
    expect(calls[0].message.data.detail).toEqual({ conversationId: 'c-9' })
  })

  it('never throws into the caller when a publish rejects', () => {
    const logger = createLogger({
      instanceId: 'chat-service-a3f1',
      source: 'chat-service',
      publish: async () => {
        throw new Error('redis down')
      },
    })
    expect(() => logger.emit('user-1', 'Message sent')).not.toThrow()
  })
})

describe('createJwtAccessTokenVerifier', () => {
  const verifier = createJwtAccessTokenVerifier(SECRET, ISSUER)

  it('returns the userId from the sub claim of a valid token', async () => {
    const token = await mint({ sub: 'user-123' })
    expect(await verifier.verify(token)).toEqual({ userId: 'user-123' })
  })

  it('rejects a token signed with the wrong secret', async () => {
    const wrong = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-123')
      .setIssuer(ISSUER)
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('a-totally-different-secret-aaaaaaaaaa'))
    await expect(verifier.verify(wrong)).rejects.toThrow()
  })

  it('rejects a token from the wrong issuer', async () => {
    const token = await mint({ sub: 'user-123', issuer: 'someone-else' })
    await expect(verifier.verify(token)).rejects.toThrow()
  })

  it('rejects a token with no sub', async () => {
    const token = await mint({})
    await expect(verifier.verify(token)).rejects.toThrow(/sub/)
  })
})
