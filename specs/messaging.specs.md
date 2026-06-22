# Feature Spec — Messaging

> **Mold:** Requirements → Design → Tasks → Decisions. Upstream: `REQUIREMENTS.md` §3 (+ §2.5 un-friend revocation). **Depends on** Auth and Friends. **Scope:** happy-path 1:1 messaging — send, persist, real-time receive, history — plus the friendship **gate** and its **revocation** on un-friend. Receipts, Presence, Typing, Reconnect/Resync are separate specs.
>
> **Decision to confirm:** written for **WS-send** (recommended for the study repo). The Decisions section notes what HTTP-send changes.

---

## 1. Requirements (the _what_)

### User stories

- **US-1** — As a user, I want to send a message to a friend.
- **US-2** — As a user, I want to receive a friend's messages in real time on all my devices.
- **US-3** — As a user, I want to load past conversation history.
- **US-4** — As a user, I want my own sent messages to appear across all my devices.

### Acceptance criteria

**Sending**

- **AC-M1** — A user SHALL send a message to a friend; it is persisted with a server UUIDv7 + timestamp, and the sender gets a `sent` ack with the canonical id + timestamp.
- **AC-M2** — The send SHALL be gated: a **new** conversation requires the pair to be active friends; an **existing** conversation requires it to be `open` (see §2.6). A blocked send is rejected and not persisted/delivered.
- **AC-M3** — Optimistic render via a client-generated id; the `sent` ack correlates via that id.
- **AC-M4** — Idempotent on the client id (retry ⇒ no duplicate, returns original canonical id).
- **AC-M5** — Empty/oversized body → rejected.

**Real-time receive**

- **AC-D1** — Recipient with ≥1 connected device → pushed to **all** their devices.
- **AC-D2** — Recipient offline → persisted, retrievable via history; no push.
- **AC-D3** — Echoed to the **sender's** other devices.

**History**

- **AC-H1** — Load history most-recent-first, paginated by a UUIDv7 cursor.
- **AC-H2** — Ordered by message UUIDv7.
- **AC-H3** — Only a conversation participant may read its history.

**Gating & revocation**

- **AC-G1** — chat-service SHALL maintain a local friends read-model from `friend_request.accepted` (→ active) and `friendship.removed` (→ removed), applied **last-writer-wins by the event's UUIDv7** (apply only if newer than the stored `last_event_id`) — making it idempotent and reorder-safe under at-least-once delivery.
- **AC-G2** — WHEN a friendship is removed, the pair's conversation (if any) SHALL be **closed**, and subsequent sends to it rejected.
- **AC-G3** — WHEN the pair re-friends, the conversation SHALL **reopen** and sending resumes; existing history is preserved.

**Ordering**

- **AC-O1** — Server assigns the canonical UUIDv7 at persist (authoritative order); client ids are optimistic/idempotency only.

### Non-functional

- Inbound is competing-consumer (one worker per message). The gateway is dumb (relay only).

---

## 2. Design (the _how_)

### 2.1 Components & responsibilities

| Component                    | Role                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway** (Go)             | Dumb relay. Inbound: stamp `senderId`, publish to the inbound queue. Outbound: subscribe `user:{id}` per held connection, write frames.                              |
| **RabbitMQ**                 | Inbound **work queue** (client messages, one worker each) **and** the `domain.events` exchange chat-service binds for the read-model.                                |
| **chat-service** (Elysia/TS) | Consumes the inbound queue (gate, persist, publish) and the friend events (read-model + conversation state). Owns conversations + messages + the friends read-model. |
| **Redis**                    | Per-user delivery channels `user:{id}`.                                                                                                                              |
| **Postgres**                 | `conversations`, `messages`, `friends_read_model`.                                                                                                                   |

### 2.2 Send path (WS-send)

1. Client → `{ type:"message.send", clientMsgId, toUserId, body }`.
2. Gateway stamps `senderId`, publishes the envelope to the inbound queue (no validation, no DB).
3. A chat-service worker: runs the gate (§2.6), validates the body, get-or-creates the conversation, persists with a server UUIDv7 deduped on `clientMsgId`.
4. Publishes outbound: message → `user:{toUserId}`, `sent` ack → `user:{senderId}`, echo → sender's other devices.
5. Subscribed gateways write to sockets; recipient shows it, sender reconciles to `sent`.

### 2.3 Delivery routing (per-user channels)

Gateway subscribes to `user:{id}` per held connection (unsubscribes on the last local disconnect). chat-service publishes only to `user:{…}`. Multi-device fan-out is automatic. Independent of the presence registry.

### 2.4 Data model

| Table                | Columns / constraints                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`      | `id` uuidv7 PK · `user_a` · `user_b` (**canonical**) · `state` enum(`open`/`closed`) · `created_at`. **Unique(`user_a`, `user_b`)**.                     |
| `messages`           | `id` uuidv7 PK · `conversation_id` FK · `sender_id` FK · `body` · `created_at`. Index `(conversation_id, id)`. **Unique(`sender_id`, `client_msg_id`)**. |
| `friends_read_model` | `pair` (canonical, e.g. `a_b`) PK · `state` enum(`active`/`removed`) · `last_event_id` uuidv7 · `updated_at`.                                            |

### 2.5 Idempotency & ordering

- `client_msg_id` is the message idempotency key (unique per sender) — a retried send returns the existing row.
- Canonical UUIDv7 assigned server-side at persist → authoritative per-conversation order; history sorts by it.

### 2.6 Friendship gating & revocation (cross-service)

**Read-model (Option 2 + soft-delete + version).** chat-service binds a durable queue to `friend_request.accepted` and `friendship.removed`, and maintains `friends_read_model` in its **own Postgres** (durable; survives restarts). Each event is applied **last-writer-wins by `eventId`**: only if the event's UUIDv7 is greater than the row's `last_event_id` do we update — `accepted` → `state=active`, `removed` → `state=removed` (a **soft-delete**: the row and its `last_event_id` are kept, so a stale/reordered re-add can't resurrect a removed friendship). This is idempotent under at-least-once delivery (AC-G1). Redis caching is **deferred** — a direct Postgres lookup is sub-ms and the gate is rare. Truth is Postgres; if a cache is ever added it is disposable.

**Where the gate fires:**

- **New conversation** (first message between a pair) — require `friends_read_model.state = active`.
- **Existing conversation** — require `conversations.state = open` (a fast local check on the conversation row; no read-model or cross-service call on the per-message hot path).

**Revocation & re-friend (conversation state):**

- On `friendship.removed` → set the pair's conversation `state=closed` (if it exists). Sends to a closed conversation are rejected (AC-G2).
- On `friend_request.accepted` → if a `closed` conversation exists for the pair, set `state=open` (re-friend resumes the same conversation; history preserved — AC-G3).

**Bootstrap/rebuild:** the read-model is rebuildable from social-service (snapshot endpoint) since RabbitMQ doesn't retain consumed events — needed only for cold-start/disaster recovery, not routine restarts (Postgres is durable).

### 2.7 Clean-architecture layering (chat-service)

- **Domain** — `Message`, `Conversation` (canonical pair, open/closed).
- **Application** — `SendMessage` (gate → get-or-create conversation → persist), `GetHistory`, consumers `ApplyFriendAccepted` / `ApplyFriendRemoved` (read-model + conversation state). Ports: `MessageRepository`, `ConversationRepository`, `FriendsReadModel`, `OutboundPublisher`, `Clock`.
- **Infrastructure** — Drizzle repos, RabbitMQ consumer, Redis publisher.
- **Interface** — inbound queue consumer; HTTP `GET` history.

---

## 3. Tasks (the build)

| #       | Task                                                                                                                                                                                                                                                                    | Covers                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **T1**  | Drizzle schema + migrations: `conversations` (canonical-pair unique, `state`), `messages` (pagination index, idempotency unique), `friends_read_model`                                                                                                                  | AC-M4, AC-H1, AC-G1               |
| **T2**  | Domain: `Message`, `Conversation` (open/closed)                                                                                                                                                                                                                         | AC-O1                             |
| **T3**  | Inbound consumer: RabbitMQ work queue, competing consumers                                                                                                                                                                                                              | non-functional                    |
| **T4**  | `SendMessage`: gate (active for new / open for existing), validate, get-or-create conversation, persist idempotent with server UUIDv7                                                                                                                                   | AC-M1, AC-M2, AC-M4, AC-M5, AC-O1 |
| **T5**  | Outbound publish: message → recipient, `sent` ack → sender, echo → sender devices                                                                                                                                                                                       | AC-M1, AC-M3, AC-D1, AC-D3        |
| **T6**  | Gateway: inbound (stamped envelope → queue), outbound (`SUBSCRIBE user:{id}`, write frames, unsubscribe on last local disconnect)                                                                                                                                       | AC-M3, AC-D1, AC-D3               |
| **T7**  | Friend events consumer: `accepted`/`removed` → `friends_read_model` LWW-by-`eventId` soft-delete; close/reopen conversation                                                                                                                                             | AC-G1, AC-G2, AC-G3               |
| **T8**  | History endpoint: UUIDv7-cursor pagination, participant authz                                                                                                                                                                                                           | AC-H1, AC-H2, AC-H3               |
| **T9**  | Drizzle repositories: `Message`, `Conversation`, `FriendsReadModel`                                                                                                                                                                                                     | AC-M*, AC-H*, AC-G1               |
| **T10** | Acceptance tests (send⇒ack+persist; non-friend rejected; retry idempotent; multi-device fan-out + echo; offline⇒history only; history pagination+authz; un-friend closes conversation ⇒ send rejected; re-friend reopens; stale/duplicate friend event ignored via LWW) | all                               |

---

## Decisions (locked / proposed)

- **Send path — PROPOSED: WS-send.** HTTP-send alternative: client `POST`s `/messages`, ack is the HTTP response, gateway becomes outbound-only, inbound RabbitMQ-from-client disappears. _(confirm)_
- **Gating — local friends read-model (Option 2)** in chat-service's Postgres: soft-delete + `last_event_id`, last-writer-wins by the event's UUIDv7; idempotent/reorder-safe. **Redis cache deferred** (gate is rare; Postgres lookup is enough). Truth is Postgres.
- **Revocation:** `friendship.removed` closes the conversation (per-message check = local `conversations.state`); `friend_request.accepted` reopens a closed one. **History preserved** across un-friend/re-friend.
- **Gate placement:** friendship checked from the read-model only at **conversation creation**; existing conversations check the local `state` — no per-message cross-service call.
- **Conversations:** lazy get-or-create on first message, canonical pair.
- **Read-model rebuild:** via a social-service snapshot (RabbitMQ isn't replayable) — cold-start/DR only.
- **Max message length:** to pick (e.g. 4000 chars). _(confirm)_
