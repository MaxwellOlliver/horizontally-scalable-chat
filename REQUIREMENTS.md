# Real-time Chat — Functional Requirements (v1)

**Scope:** 1:1 chat for a large-scale, horizontally-scaled architecture. The point of the project is the distributed real-time path (multiple WebSocket gateways, presence, cross-instance delivery), so group chat and peripheral features are deliberately out of scope.

**Conventions used throughout:**

- All entity ids are **UUIDv7** — time-sortable, so they double as ordering keys and as resync cursors. The **server** assigns the canonical UUIDv7 at persist time (authoritative ordering; avoids cross-client clock skew). The client may attach a separate temporary id / idempotency key for optimistic rendering and de-duplication.
- "Durable" events (messages, friend-request notifications) are persisted and must survive a disconnect. "Ephemeral" signals (typing, presence) are transient, never persisted, and self-correct on reconnect.

---

## 1. Accounts & Authentication

1.1. A user can create an account and log in.
1.2. Authentication is token-based (JWT). The same token authenticates both the REST API and the WebSocket handshake.
1.3. On every new WebSocket connection (including reconnects), the gateway validates the token before registering the connection.

## 2. Friends

2.1. A user can send a friend request to another user.
2.2. The recipient can **accept** or **reject** a request. (No cancel; no block/remove in v1.)
2.3. A notification is generated on **acceptance only** — not on rejection.
2.4. **Dependency:** messaging is gated on an _accepted_ friendship. A user can only message confirmed friends, so the accept flow (2.2) must exist before messaging (Section 3) can be exercised.

## 3. Messaging (1:1 only)

3.1. A user can send a message to a friend.
3.2. **Persistence:** every message is durably stored with a server-assigned UUIDv7 id and server timestamp. Messages are never fire-and-forget only.
3.3. **Real-time receive:** when the recipient is connected, the message is pushed to them in real time (outbound fan-out via Redis Pub/Sub to the gateway holding their connection).
3.4. **Offline delivery:** a message sent to an offline recipient is stored and delivered when they reconnect (see resync, Section 8). Until then the sender sees it as `sent`, not `delivered`.
3.5. **History:** opening a conversation loads past messages from the durable store, ordered by UUIDv7 (which is creation order). No separate sequence column is needed.

## 4. Delivery & Read Receipts (`sent → delivered → seen`)

The sender sees the status of each message advance through three states. **Core principle:** delivery cannot be inferred from "we published it" — the recipient's device must report it back. A receipt is just a message _about_ a message, flowing backward through the same outbound pipe.

4.1. **`sent`** — the server has durably persisted the message and acked the sender with the canonical UUIDv7 + timestamp. The sender's client renders optimistically using its temp id, then reconciles to the canonical id on ack.
4.2. **`delivered`** — the recipient's device received the message, via either a live push **or** a catch-up fetch on reconnect. The recipient's client reports delivery back to the sender.
4.3. **`seen`** — the recipient actually viewed the message. Requires the recipient's tab to be **focused** (ties to presence in Section 5); a message received while idle is delivered-but-not-seen until focus + view.

**Implementation model — per-conversation high-water marks (not per-message events):**
4.4. For each conversation and direction, store two pointers: **`delivered_up_to`** and **`read_up_to`**, each holding a message UUIDv7. Because UUIDv7 is sortable, "read up to N" means _every_ message with id ≤ N is seen.
4.5. The sender's client computes every checkmark **locally** from these two pointers — no per-message receipt rows to sync. Invariant: `delivered_up_to ≥ read_up_to`.
4.6. **Debounce emission:** the recipient does not emit a receipt per message while scrolling; it emits `read up to N` once per burst (same spirit as the typing-indicator debounce).
4.7. **Idempotent:** advancing a high-water mark is `max()`, so duplicate or retried receipts are harmless.
4.8. **Multi-device collapse:** `delivered` = reached at least one of the recipient's devices; `seen` = viewed on at least one. The sender's UI sees a single collapsed status, not per-device state.

## 5. Presence (focus-driven, not socket-driven)

5.1. Three states, driven by the client reporting focus/blur (`visibilitychange`) over the socket — a live socket alone is **not** "online":

- **Online** — tab is focused.
- **Idle** — connection open but tab not focused.
- **Offline** — no live connection.
  5.2. **Multi-device precedence:** a user's effective status is the _most-present_ state across all their active connections, in the order Online (0) > Idle (1) > Offline (2). If any device is Online → Online; else if any is Idle → Idle; else Offline.
  5.3. Presence is stored in Redis as the set of a user's active connections, with a TTL refreshed by heartbeat (self-healing if a connection/gateway dies).
  5.4. Friends see each other's presence changes in real time.

## 6. Typing Indicator

6.1. A user can see when a friend is typing in the active conversation.
6.2. Ephemeral signal over the WebSocket: debounced `typing-start` / `typing-stop` with a timeout fallback. Not persisted, not resynced.

## 7. Notifications

7.1. A user is notified of an incoming friend request.
7.2. A user is notified when a friend request they sent is accepted.
7.3. Notifications travel through the same outbound pipe as messages but can be modeled more simply as read/unread (no three-state ladder).

## 8. Connection Resilience — Reconnect & Resync (client)

Connections drop routinely (network switch, sleep/wake, backgrounding, LB idle timeout, deploys), so this is normal lifecycle, not an edge case. Two distinct halves:

**8.1. Heartbeat / liveness (prerequisite)**

- Application-level ping/pong. If the client gets no pong within N seconds, it declares the socket dead and reconnects, even if the OS still thinks it is open.
- The same heartbeat drives the server-side presence TTL (Section 5.3).

**8.2. Reconnect (the connection half)**

- Reconnect with **exponential backoff + jitter** to avoid a thundering herd when a gateway comes back.
- On reconnect: re-present the token (refresh if expired), re-report focus state, re-subscribe to conversations.
- The client may land on **any** gateway and simply re-registers there — no sticky sessions required (the presence registry makes location a lookup, not a fixed assignment).

**8.3. Resync (the missed-data half)**

- Only durable events need catch-up; typing/presence self-correct.
- **Messages:** keep a cursor = the last seen message UUIDv7 (per conversation, or a global "since"). On reconnect, `GET messages since {cursor}`, merge, **dedupe by id** (a live push may arrive for the same message during reconnect), then resume treating the live socket as source of truth.
- **Receipts/status:** receipts are themselves missable events. A naive `since {messageId}` query returns only _newer_ messages and will silently miss status changes to _older_ messages the client already holds. Therefore resync fetches each conversation's current **`delivered_up_to` / `read_up_to`** pointers and recomputes checkmarks — sync the pointer, not individual receipt events.
- The catch-up fetch is also where the recipient emits `delivered` for all the gap messages it just pulled (which is how a sender's `sent` flips to `delivered` only once the recipient comes back online).

---

## Out of scope (v1) — recorded as conscious decisions

- **Group chats / channels.** (Note: this is what would exercise per-room broadcast channels — a good later extension if you want to feel the room fan-out.)
- Friend-request cancel; blocking or removing friends.
- Message edit/delete; search.
- Read-receipt privacy toggle; "last seen at" timestamp.
- **Gateway-death handling beyond TTL.** Server-side cleanup is covered by the presence TTL (5.3); fuller failover is deferred. Client-side recovery is already covered by Section 8.

## Deferred but recommended order of build

1. Auth + friends (Sections 1–2) — unblocks everything.
2. Happy-path messaging + persistence + history (Section 3).
3. Presence + typing (Sections 5–6).
4. Receipts via high-water marks (Section 4).
5. Reconnect + resync (Section 8) — build last, but before testing on a real network.
