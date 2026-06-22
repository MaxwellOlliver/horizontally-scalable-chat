# Feature Spec — Friends

> **Mold:** Requirements (the _what_) → Design (the _how_) → Tasks → Decisions. Upstream input: `REQUIREMENTS.md` §2. **Depends on** Auth. **Gates** Messaging. **No separate notification-service.** Friends has two outbound seams: it emits `friend_request.*` / `friendship.removed` **integration events** to the event bus for backend consumers, and it pushes a **real-time list-update frame** directly to the affected user(s). The lists remain the source of truth.

---

## 1. Requirements (the _what_)

### User stories

- **US-1** — As a user, I want to send a friend request so we can become friends and chat.
- **US-2** — As a user, I want to accept or reject incoming requests so I control who can message me.
- **US-3** — As a user, I want to see my friends and my pending requests.
- **US-4** — As a user, I want to remove a friend.

> There is **no separate "notifications" feature** in v1: the pending-requests list _is_ the inbox. A real-time frame (§2.4b) keeps lists live without a refresh.

### Acceptance criteria

**Sending a request**

- **AC-S1** — A user SHALL be able to send a friend request to another existing user, creating a `pending` request, emitting `friend_request.created`, and pushing a real-time frame to the addressee.
- **AC-S2** — WHEN the target is the requester themselves → reject `422`.
- **AC-S3** — WHEN the two users are already friends → reject `409`.
- **AC-S4** — WHEN a `pending` request already exists from requester to the same addressee → reject duplicate `409`.
- **AC-S5** — WHEN a `pending` request exists in the **reverse** direction → accept it instead (mutual intent ⇒ friendship) and return the friendship.
- **AC-S6** — WHEN the addressee does not exist → reject `404`.
- **AC-S7** — A previously **rejected** request SHALL NOT block a new request later.

**Responding to a request**

- **AC-R1** — The addressee of a `pending` request SHALL be able to **accept** it → creates a symmetric friendship, marks `accepted`.
- **AC-R2** — The addressee SHALL be able to **reject** a `pending` request → marks `rejected`, no friendship.
- **AC-R3** — WHEN anyone other than the addressee responds → reject `403`.
- **AC-R4** — WHEN the request is not `pending` → reject `409` (atomic single-shot transition).
- **AC-R5** — Accepting SHALL be concurrency-safe: of two racing accepts, exactly one creates the friendship.

**Removing a friend (un-friend)**

- **AC-U1** — **Either party** of a friendship SHALL be able to remove it, deleting the friendship, emitting `friendship.removed`, and pushing a real-time frame to **both** users.
- **AC-U2** — WHEN no friendship exists between the two users, removal SHALL be a no-op returning `404`.
- **AC-U3** — After removal, a new friend request between the two users SHALL be allowed (re-friend).

**Friendship & gating**

- **AC-F1** — A friendship SHALL be symmetric and unique per pair.
- **AC-F2** — The system SHALL expose an "are X and Y friends?" check, consumed by Messaging.
- **AC-F3** — A user SHALL be able to list their friends and incoming/outgoing pending requests — the durable source of truth.

**Integration events (event bus)**

- **AC-E1** — On create → emit `friend_request.created`.
- **AC-E2** — On accept → emit `friend_request.accepted`.
- **AC-E3** — On reject → emit nothing.
- **AC-E4** — On remove → emit `friendship.removed`.
- **AC-E5** — Events SHALL be emitted only after the state change commits, and SHALL carry an `eventId` (UUIDv7). Because per-pair transitions are serialized (atomic), the `eventId` is a monotonic per-pair ordering marker consumers can use for last-writer-wins.

**Real-time list updates (direct push)**

- **AC-P1** — On create → push a frame to the addressee's devices (incoming-requests list updates).
- **AC-P2** — On accept → push a frame to the requester's devices (friends list updates; outgoing request drops).
- **AC-P3** — On reject → push nothing.
- **AC-P4** — On remove → push a frame to **both** users (friend drops from each friends list).
- **AC-P5** — Pushes are best-effort: WHEN a user is offline, the change is reflected on their next list load. Lists are correctness; push is optimization.

### Non-functional

- All mutations authenticated. Accept/reject/remove are atomic transitions.

---

## 2. Design (the _how_)

### 2.1 Components & responsibilities

| Component                      | Role                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **social-service** (Elysia/TS) | Owns friend requests, friendships, lists. Emits integration events **and** pushes real-time frames.                                                                           |
| **Message broker** (RabbitMQ)  | Topic exchange carrying `friend_request.*` and `friendship.removed`; consumers bind durable queues (v1: chat-service binds `friend_request.accepted` + `friendship.removed`). |
| **Redis**                      | Per-user channels `user:{id}` for the real-time push (same mechanism Messaging uses).                                                                                         |
| **Gateway**                    | Forwards frames to held users' sockets — already subscribed from Messaging; no friends-specific logic.                                                                        |
| **Postgres**                   | `friend_requests`, `friendships`.                                                                                                                                             |

### 2.2 Data model

| Table             | Columns / constraints                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `friend_requests` | `id` uuidv7 PK · `requester_id` · `addressee_id` · `status` enum(`pending`/`accepted`/`rejected`) · `created_at` · `responded_at`. **Partial unique** on `(requester_id, addressee_id) WHERE status='pending'`. |
| `friendships`     | `id` uuidv7 PK · `user_a` · `user_b` (**canonical order**) · `created_at`. **Unique(`user_a`, `user_b`)**.                                                                                                      |

social-service **hard-deletes** a friendship row on un-friend — it holds current-state truth and needs no version, because the _event's_ UUIDv7 carries the ordering downstream consumers need.

### 2.3 Lifecycle

- **send** — validate; reverse-pending → accept (AC-S5); else insert `pending`, emit `friend_request.created`, push to `user:{addresseeId}`.
- **accept** — atomic `UPDATE … WHERE status='pending' AND addressee_id=:me`; on success insert friendship `ON CONFLICT DO NOTHING`, emit `friend_request.accepted`, push to `user:{requesterId}`.
- **reject** — atomic update to `rejected`; no event, no push.
- **remove** — verify the friendship exists (else `404`); delete the canonical row; emit `friendship.removed`; push to **both** `user:{a}` and `user:{b}`.

### 2.4 Two outbound seams

**(a) Event bus — service-to-service.** Emit `friend_request.created` / `friend_request.accepted` / `friendship.removed` to the `domain.events` topic exchange. v1 consumer: **chat-service** binds `friend_request.accepted` (open) and `friendship.removed` (close) for its friends read-model and conversation state. Emit-after-commit; each event carries `{ eventId (uuidv7), type, occurredAt, ...userIds }`. Per-pair transitions are serialized, so `eventId` is a reliable per-pair ordering key for last-writer-wins.

**(b) Real-time push — service-to-user.** Publish a list-update frame to the affected user's `user:{id}` Redis channel: create → addressee; accept → requester; remove → both users. The gateway forwards it. Offline → no subscriber → list reflects it on next load.

### 2.5 Cross-feature contracts

- **Domain event schema** (incl. `friendship.removed`) — contract with backend consumers.
- **Real-time frame envelope** on `user:{id}` — same family as chat; gateway forwards blindly.
- **Friendship check** (`AreFriends`, AC-F2) — consumed by Messaging.

### 2.6 API contracts

All routes are under the `/social` service prefix (mirrors `/auth/*` → auth-service); `/friends` is the resource.

| Endpoint                                                    | Request           | Success                     | Errors              |
| ---------------------------------------------------------- | ----------------- | --------------------------- | ------------------- |
| `POST /social/friends/requests`                            | `{ addresseeId }` | `201 { requestId, status }` | `404`, `409`, `422` |
| `POST /social/friends/requests/{id}/accept`                | —                 | `200 { friendshipId }`      | `403`, `404`, `409` |
| `POST /social/friends/requests/{id}/reject`                | —                 | `204`                       | `403`, `404`, `409` |
| `DELETE /social/friends/{userId}`                          | —                 | `204`                       | `404`               |
| `GET /social/friends`                                      | —                 | `200 [ friends ]`           | —                   |
| `GET /social/friends/requests?direction=incoming\|outgoing` | —                 | `200 [ requests ]`          | —                   |

### 2.7 Clean-architecture layering (social-service)

- **Domain** — `FriendRequest` (state machine), `Friendship` (canonical pair), event types.
- **Application** — `SendFriendRequest`, `AcceptFriendRequest`, `RejectFriendRequest`, `RemoveFriend`, `AreFriends`, `ListFriends`, `ListPendingRequests`. Ports: `FriendRequestRepository`, `FriendshipRepository`, `DomainEventPublisher`, `LivePush`, `Clock`.
- **Infrastructure** — Drizzle repos; RabbitMQ `DomainEventPublisher`; Redis `LivePush`.
- **Interface** — Elysia routes + validation + error→status.

---

## 3. Tasks (the build)

| #      | Task                                                                                                                                                                                 | Covers                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **T1** | Drizzle schema + migrations: `friend_requests` (partial-unique pending), `friendships` (canonical-pair unique)                                                                       | AC-S4, AC-F1                |
| **T2** | Domain: `FriendRequest` state machine, `Friendship`, event types                                                                                                                     | AC-R4, AC-E\*               |
| **T3** | Use cases: `SendFriendRequest`, `AcceptFriendRequest` (atomic + `ON CONFLICT`), `RejectFriendRequest`, `RemoveFriend` (verify exists → delete)                                       | AC-S*, AC-R*, AC-U\*        |
| **T4** | `DomainEventPublisher`: emit `friend_request.created/accepted` and `friendship.removed` after commit with `eventId`; nothing on reject                                               | AC-E1–E5                    |
| **T5** | `LivePush`: frames to `user:{id}` — create→addressee, accept→requester, remove→both; nothing on reject                                                                               | AC-P1–P5                    |
| **T6** | `AreFriends` use case/port for the Messaging gate                                                                                                                                    | AC-F2                       |
| **T7** | Drizzle repositories: `FriendRequest`, `Friendship`                                                                                                                                  | AC-S*, AC-U*, AC-F1         |
| **T8** | Elysia routes + validation + error→status (`/friends/*`, `DELETE /friends/{userId}`)                                                                                                 | AC-S2/3/4/6, AC-R3/4, AC-U2 |
| **T9** | Acceptance tests, one per AC (incl. un-friend by either party, remove-when-not-friends `404`, re-friend allowed, `friendship.removed` event + push to both, no event/push on reject) | all                         |

---

## Decisions (locked)

- **Un-friend is in scope.** Either party can remove a friendship; emits `friendship.removed`; re-friend allowed afterward.
- **social-service hard-deletes** the friendship row (current-state truth); the event's **UUIDv7 `eventId`** carries the per-pair ordering that consumers need for last-writer-wins.
- **Event bus stays** (`friend_request.*` + `friendship.removed`); no notification-service.
- **Two outbound seams:** RabbitMQ events for services, direct Redis push for live UI.
- **Push is optimization; lists are correctness.** Reuses Messaging's per-user channels — no new gateway logic.
- **Friendship model / auto-accept / re-request / atomic transitions** — unchanged.
