import { DuplicateRequestError } from '../../domain/errors.js'
import type { FriendRequest, FriendRequestStatus } from '../../domain/friend-request.js'
import { canonicalPair, type Friendship } from '../../domain/friendship.js'
import type { Clock } from '../../application/ports/clock.js'
import type { DomainEventPublisher } from '../../application/ports/domain-event-publisher.js'
import type { FriendRequestRepository } from '../../application/ports/friend-request-repository.js'
import type { FriendshipRepository } from '../../application/ports/friendship-repository.js'
import type { IdGenerator } from '../../application/ports/id-generator.js'
import type { LiveFrame, LivePush } from '../../application/ports/live-push.js'
import type { UserDirectory } from '../../application/ports/user-directory.js'
import type { DomainEvent } from '../../domain/events.js'

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
 * Monotonic id generator producing valid UUIDs (8-4-4-4-12 hex) so generated
 * request/friendship ids survive the `z.string().uuid()` validation when they
 * flow back through the HTTP layer (e.g. `/requests/:id/accept`). Deterministic
 * and sortable, which keeps canonical-pair ordering predictable.
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
 * In-memory friend-request store mirroring the Drizzle repo's observable
 * behaviour: the partial-unique (pending) index becomes a guard in `create`
 * (AC-S4) and `transition` is a single-shot atomic conditional update (AC-R4/R5).
 * Method bodies are synchronous (no internal await), so two concurrent accepts
 * raced via `Promise.all` resolve deterministically — one transition wins.
 */
export class InMemoryFriendRequestRepository implements FriendRequestRepository {
  readonly rows = new Map<string, FriendRequest>()

  async create(request: FriendRequest): Promise<void> {
    for (const r of this.rows.values()) {
      if (
        r.status === 'pending' &&
        r.requesterId === request.requesterId &&
        r.addresseeId === request.addresseeId
      ) {
        throw new DuplicateRequestError()
      }
    }
    this.rows.set(request.id, { ...request })
  }

  async findById(id: string): Promise<FriendRequest | null> {
    const r = this.rows.get(id)
    return r ? { ...r } : null
  }

  async findPending(requesterId: string, addresseeId: string): Promise<FriendRequest | null> {
    for (const r of this.rows.values()) {
      if (r.status === 'pending' && r.requesterId === requesterId && r.addresseeId === addresseeId) {
        return { ...r }
      }
    }
    return null
  }

  async transition(
    id: string,
    addresseeId: string,
    to: Extract<FriendRequestStatus, 'accepted' | 'rejected'>,
    at: Date,
  ): Promise<FriendRequest | null> {
    const r = this.rows.get(id)
    if (!r || r.status !== 'pending' || r.addresseeId !== addresseeId) {
      return null
    }
    const updated: FriendRequest = { ...r, status: to, respondedAt: at }
    this.rows.set(id, updated)
    return { ...updated }
  }

  async listPending(
    userId: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<FriendRequest[]> {
    const out: FriendRequest[] = []
    for (const r of this.rows.values()) {
      if (r.status !== 'pending') continue
      const match = direction === 'incoming' ? r.addresseeId === userId : r.requesterId === userId
      if (match) out.push({ ...r })
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
}

/**
 * In-memory friendship store. `ensure` is idempotent on the canonical pair, so
 * a second (racing) accept returns the existing row instead of creating a
 * duplicate (AC-R5/F1).
 */
export class InMemoryFriendshipRepository implements FriendshipRepository {
  private readonly byPair = new Map<string, Friendship>()

  async ensure(id: string, userA: string, userB: string, createdAt: Date): Promise<Friendship> {
    const key = `${userA}|${userB}`
    const existing = this.byPair.get(key)
    if (existing) return { ...existing }
    const friendship: Friendship = { id, userA, userB, createdAt }
    this.byPair.set(key, friendship)
    return { ...friendship }
  }

  async areFriends(x: string, y: string): Promise<boolean> {
    const { userA, userB } = canonicalPair(x, y)
    return this.byPair.has(`${userA}|${userB}`)
  }

  async listForUser(userId: string): Promise<Friendship[]> {
    const out: Friendship[] = []
    for (const f of this.byPair.values()) {
      if (f.userA === userId || f.userB === userId) out.push({ ...f })
    }
    return out
  }

  async remove(x: string, y: string): Promise<Friendship | null> {
    const { userA, userB } = canonicalPair(x, y)
    const key = `${userA}|${userB}`
    const existing = this.byPair.get(key)
    if (!existing) return null
    this.byPair.delete(key)
    return { ...existing }
  }

  /** Test helper: number of distinct friendships (AC-R5/F1 uniqueness checks). */
  get size(): number {
    return this.byPair.size
  }
}

/** Captures emitted integration events for assertions (AC-E*). */
export class CapturingEventPublisher implements DomainEventPublisher {
  readonly events: DomainEvent[] = []
  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event)
  }
}

/** Captures live-push frames (and their target user) for assertions (AC-P*). */
export class CapturingLivePush implements LivePush {
  readonly frames: Array<{ userId: string; frame: LiveFrame }> = []
  async pushToUser(userId: string, frame: LiveFrame): Promise<void> {
    this.frames.push({ userId, frame })
  }
}

/**
 * A LivePush whose delivery always fails — models an offline user / Redis
 * hiccup. Used to prove the push is best-effort: the mutation still commits and
 * the lists remain the source of truth (AC-P4).
 */
export class FailingLivePush implements LivePush {
  async pushToUser(): Promise<void> {
    throw new Error('no subscriber')
  }
}

/** Existence directory backed by a set of known user ids (AC-S6). */
export class InMemoryUserDirectory implements UserDirectory {
  readonly ids = new Set<string>()
  async exists(userId: string): Promise<boolean> {
    return this.ids.has(userId)
  }
}
