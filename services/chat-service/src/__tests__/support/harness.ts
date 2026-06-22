import { SignJWT } from 'jose'
import { uuidv7 } from 'uuidv7'
import { createJwtAccessTokenVerifier } from '@hsc/platform'
import { createApp } from '../../app.js'
import { assembleUseCases, type ChatPorts } from '../../composition-root.js'
import type { OutboundPublisher } from '../../application/ports/outbound-publisher.js'
import type { FriendAcceptedEvent } from '../../application/use-cases/apply-friend-accepted.js'
import type { FriendRemovedEvent } from '../../application/use-cases/apply-friend-removed.js'
import { createFriendEventHandler } from '../../interface/queue/friend-event-handler.js'
import { createInboundHandler } from '../../interface/queue/inbound-handler.js'
import {
  CapturingOutboundPublisher,
  FakeClock,
  InMemoryConversationRepository,
  InMemoryFriendsReadModel,
  InMemoryMessageRepository,
  SequentialUuidGenerator,
} from './fakes.js'

const SECRET = 'test-secret-test-secret-test-secret-123'
const ISSUER = 'hsc-auth-test'

export interface TestResponse {
  status: number
  body: any
}

export interface RequestOptions {
  token?: string
}

export interface TestUser {
  id: string
  token: string
}

/** A `message.send` envelope as the gateway would publish it (senderId stamped). */
export interface SendEnvelope {
  type?: string
  clientMsgId: string
  senderId: string
  toUserId: string
  body: string
}

export interface Harness {
  messages: InMemoryMessageRepository
  conversations: InMemoryConversationRepository
  friends: InMemoryFriendsReadModel
  outbound: CapturingOutboundPublisher
  clock: FakeClock
  ids: SequentialUuidGenerator
  /** Mints a valid token + id for a user. */
  createUser: () => Promise<TestUser>
  tokenFor: (userId: string) => Promise<string>
  /** Drives the inbound work-queue handler with a raw envelope (the real send path). */
  send: (envelope: SendEnvelope) => Promise<void>
  /** Drives the `domain.events` handler with a raw friend event (the real event path). */
  deliverFriendEvent: (event: Record<string, unknown>) => Promise<void>
  /** Convenience: emit a well-formed `friend_request.accepted`. */
  acceptFriends: (
    requesterId: string,
    addresseeId: string,
    eventId?: string,
  ) => Promise<void>
  /** Convenience: emit a well-formed `friendship.removed`. */
  removeFriends: (x: string, y: string, eventId?: string) => Promise<void>
  request: (method: string, path: string, opts?: RequestOptions) => Promise<TestResponse>
}

/**
 * Builds the real use-case wiring + queue handlers + Elysia app over in-memory
 * fakes. The access-token verifier is the production HS256 adapter fed real
 * signed JWTs, so the auth path (401s) and the cross-service token contract are
 * exercised for real. `outbound` can be overridden (e.g. FailingOutboundPublisher)
 * to prove pushes are best-effort without affecting the durable store (AC-D2).
 */
export function buildHarness(overrides: { outbound?: OutboundPublisher } = {}): Harness {
  const messages = new InMemoryMessageRepository()
  const conversations = new InMemoryConversationRepository()
  const friends = new InMemoryFriendsReadModel()
  const outbound = new CapturingOutboundPublisher()
  const clock = new FakeClock()
  const ids = new SequentialUuidGenerator()

  const ports: ChatPorts = {
    messages,
    conversations,
    friends,
    outbound: overrides.outbound ?? outbound,
    ids,
    clock,
  }

  const useCases = assembleUseCases(ports)
  const verifier = createJwtAccessTokenVerifier(SECRET, ISSUER)
  const app = createApp(useCases, verifier)

  const inboundHandler = createInboundHandler({
    sendMessage: useCases.sendMessage,
    outbound: overrides.outbound ?? outbound,
  })
  const friendEventHandler = createFriendEventHandler({
    applyFriendAccepted: useCases.applyFriendAccepted,
    applyFriendRemoved: useCases.applyFriendRemoved,
  })

  const key = new TextEncoder().encode(SECRET)
  const tokenFor = (userId: string): Promise<string> =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key)

  const createUser = async (): Promise<TestUser> => {
    const id = uuidv7()
    return { id, token: await tokenFor(id) }
  }

  const send = (envelope: SendEnvelope): Promise<void> =>
    inboundHandler({ type: 'message.send', ...envelope })

  const deliverFriendEvent = (event: Record<string, unknown>): Promise<void> =>
    friendEventHandler(event)

  const acceptFriends = (
    requesterId: string,
    addresseeId: string,
    eventId = ids.next(),
  ): Promise<void> =>
    friendEventHandler({
      type: 'friend_request.accepted',
      eventId,
      occurredAt: clock.now().toISOString(),
      requesterId,
      addresseeId,
    } satisfies FriendAcceptedEvent & { type: string })

  const removeFriends = (x: string, y: string, eventId = ids.next()): Promise<void> => {
    const userA = x < y ? x : y
    const userB = x < y ? y : x
    return friendEventHandler({
      type: 'friendship.removed',
      eventId,
      occurredAt: clock.now().toISOString(),
      userA,
      userB,
      removedBy: x,
    } satisfies FriendRemovedEvent & { type: string; removedBy: string })
  }

  const request = async (
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<TestResponse> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    const res = await app.handle(new Request(`http://localhost${path}`, { method, headers }))
    const text = await res.text()
    return { status: res.status, body: text ? safeJson(text) : null }
  }

  return {
    messages,
    conversations,
    friends,
    outbound,
    clock,
    ids,
    createUser,
    tokenFor,
    send,
    deliverFriendEvent,
    acceptFriends,
    removeFriends,
    request,
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
