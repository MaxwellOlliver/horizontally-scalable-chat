import { pairKey, type Conversation } from '../../domain/conversation.js'
import type { Message } from '../../domain/message.js'
import type { Clock } from '../../application/ports/clock.js'
import type { ConversationRepository } from '../../application/ports/conversation-repository.js'
import type { FriendsReadModel, FriendState } from '../../application/ports/friends-read-model.js'
import type { IdGenerator } from '../../application/ports/id-generator.js'
import type { MessagePage, MessageRepository } from '../../application/ports/message-repository.js'
import type {
  OutboundFrame,
  OutboundPublisher,
} from '../../application/ports/outbound-publisher.js'
import type {
  ReceiptPointer,
  ReceiptRepository,
} from '../../application/ports/receipt-repository.js'
import type { UserDirectory, UserProfile } from '../../application/ports/user-directory.js'

/** Advanceable clock for deterministic timestamps. */
export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000)
  }
}

/**
 * Monotonic id generator producing valid, sortable UUIDs (8-4-4-4-12 hex) so
 * generated message/conversation ids survive `z.string().uuid()` validation when
 * they flow through the HTTP history layer, and keyset ordering is predictable.
 */
export class SequentialUuidGenerator implements IdGenerator {
  private n = 0
  next(): string {
    this.n += 1
    const hex = this.n.toString(16).padStart(12, '0')
    return `00000000-0000-7000-8000-${hex}`
  }
}

/**
 * In-memory message store mirroring the Drizzle repo's observable behaviour: the
 * unique `(sender_id, client_msg_id)` index becomes the idempotency guard in
 * `insert` (AC-M4), and `page` is keyset pagination most-recent-first (AC-H1/H2).
 */
export class InMemoryMessageRepository implements MessageRepository {
  readonly rows: Message[] = []

  constructor(
    private readonly receipts?: { readUpTo(conversationId: string, userId: string): string | null },
  ) {}

  async insert(message: Message): Promise<{ message: Message; created: boolean }> {
    const existing = this.rows.find(
      (m) => m.senderId === message.senderId && m.clientMsgId === message.clientMsgId,
    )
    if (existing) {
      return { message: { ...existing }, created: false }
    }
    this.rows.push({ ...message })
    return { message: { ...message }, created: true }
  }

  async page(conversationId: string, opts: MessagePage): Promise<Message[]> {
    return this.rows
      .filter((m) => m.conversationId === conversationId)
      .filter((m) => (opts.before ? m.id < opts.before : true))
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)) // desc by id
      .slice(0, opts.limit)
      .map((m) => ({ ...m }))
  }

  async latestByConversations(conversationIds: string[]): Promise<Message[]> {
    const ids = new Set(conversationIds)
    const latest = new Map<string, Message>()
    for (const m of this.rows) {
      if (!ids.has(m.conversationId)) continue
      const current = latest.get(m.conversationId)
      if (!current || m.id > current.id) latest.set(m.conversationId, m)
    }
    return [...latest.values()].map((m) => ({ ...m }))
  }

  async unreadCounts(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
    const ids = new Set(conversationIds)
    const counts = new Map<string, number>()
    for (const m of this.rows) {
      if (!ids.has(m.conversationId) || m.senderId === userId) continue
      const readUpTo = this.receipts?.readUpTo(m.conversationId, userId) ?? null
      if (readUpTo && m.id <= readUpTo) continue
      counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1)
    }
    return counts
  }
}

/**
 * In-memory conversation store. `create` is idempotent on the canonical pair
 * (concurrent first-message returns the existing row); `reopen` only flips a
 * closed row (AC-G3), `close` is a no-op when none exists.
 */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly byPair = new Map<string, Conversation>()

  async listForUser(userId: string): Promise<Conversation[]> {
    const out: Conversation[] = []
    for (const c of this.byPair.values()) {
      if (c.userA === userId || c.userB === userId) out.push({ ...c })
    }
    return out
  }

  async findByPair(userA: string, userB: string): Promise<Conversation | null> {
    const c = this.byPair.get(`${userA}|${userB}`)
    return c ? { ...c } : null
  }

  async findById(id: string): Promise<Conversation | null> {
    for (const c of this.byPair.values()) {
      if (c.id === id) return { ...c }
    }
    return null
  }

  async create(id: string, userA: string, userB: string, createdAt: Date): Promise<Conversation> {
    const key = `${userA}|${userB}`
    const existing = this.byPair.get(key)
    if (existing) return { ...existing }
    const conversation: Conversation = { id, userA, userB, state: 'open', createdAt }
    this.byPair.set(key, conversation)
    return { ...conversation }
  }

  async close(userA: string, userB: string): Promise<void> {
    const key = `${userA}|${userB}`
    const c = this.byPair.get(key)
    if (c) this.byPair.set(key, { ...c, state: 'closed' })
  }

  async reopen(userA: string, userB: string): Promise<void> {
    const key = `${userA}|${userB}`
    const c = this.byPair.get(key)
    if (c && c.state === 'closed') this.byPair.set(key, { ...c, state: 'open' })
  }
}

/**
 * In-memory friends read-model. `apply` is last-writer-wins by `eventId`
 * (UUIDv7 string compare = time order), so a stale/duplicate event is ignored
 * (returns false) and never resurrects a removed pair (AC-G1).
 */
export class InMemoryFriendsReadModel implements FriendsReadModel {
  readonly rows = new Map<string, { state: FriendState; lastEventId: string }>()

  async isActive(x: string, y: string): Promise<boolean> {
    return this.rows.get(pairKey(x, y))?.state === 'active'
  }

  async apply(pair: string, state: FriendState, eventId: string): Promise<boolean> {
    const existing = this.rows.get(pair)
    if (existing && existing.lastEventId >= eventId) return false
    this.rows.set(pair, { state, lastEventId: eventId })
    return true
  }

  /** Test helper: seed an active friendship directly (skips the event path). */
  setActive(x: string, y: string, eventId: string): void {
    this.rows.set(pairKey(x, y), { state: 'active', lastEventId: eventId })
  }
}

/** Captures outbound frames (and their target user) for assertions (AC-D*, AC-M*). */
export class CapturingOutboundPublisher implements OutboundPublisher {
  readonly frames: Array<{ userId: string; frame: OutboundFrame }> = []

  async publishToUser(userId: string, frame: OutboundFrame): Promise<void> {
    this.frames.push({ userId, frame })
  }

  /** All frames sent to a given user. */
  to(userId: string): OutboundFrame[] {
    return this.frames.filter((f) => f.userId === userId).map((f) => f.frame)
  }

  /** All frames of a given type. */
  ofType(type: OutboundFrame['type']): Array<{ userId: string; frame: OutboundFrame }> {
    return this.frames.filter((f) => f.frame.type === type)
  }
}

/**
 * An OutboundPublisher whose delivery always fails — models an offline (no
 * subscriber) recipient / Redis hiccup. Proves the push is best-effort: the
 * message still persists and is retrievable via history (AC-D2).
 */
export class FailingOutboundPublisher implements OutboundPublisher {
  async publishToUser(): Promise<void> {
    throw new Error('no subscriber')
  }
}

/** In-memory receipt pointers, mirroring the GREATEST-advance repo (max, §4.7). */
export class InMemoryReceiptRepository implements ReceiptRepository {
  readonly rows = new Map<string, ReceiptPointer>()

  async advance(
    conversationId: string,
    userId: string,
    deliveredUpTo: string | null,
    readUpTo: string | null,
  ): Promise<ReceiptPointer> {
    const key = `${conversationId}|${userId}`
    const current = this.rows.get(key) ?? { userId, deliveredUpTo: null, readUpTo: null }
    const next: ReceiptPointer = {
      userId,
      deliveredUpTo: maxId(current.deliveredUpTo, deliveredUpTo),
      readUpTo: maxId(current.readUpTo, readUpTo),
    }
    this.rows.set(key, next)
    return { ...next }
  }

  async listForConversation(conversationId: string): Promise<ReceiptPointer[]> {
    const out: ReceiptPointer[] = []
    for (const [key, pointer] of this.rows) {
      if (key.startsWith(`${conversationId}|`)) out.push({ ...pointer })
    }
    return out
  }

  /** Synchronous read used by the message fake to compute unread counts. */
  readUpTo(conversationId: string, userId: string): string | null {
    return this.rows.get(`${conversationId}|${userId}`)?.readUpTo ?? null
  }
}

function maxId(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}

/** In-memory user directory (the shared `users` table) for display-name resolution. */
export class InMemoryUserDirectory implements UserDirectory {
  readonly profiles = new Map<string, UserProfile>()

  async listProfiles(ids: string[]): Promise<UserProfile[]> {
    return ids.flatMap((id) => {
      const profile = this.profiles.get(id)
      return profile ? [{ ...profile }] : []
    })
  }

  /** Test helper: register a user's display name. */
  add(id: string, displayName: string): void {
    this.profiles.set(id, { id, displayName })
  }
}
