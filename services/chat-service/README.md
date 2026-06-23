# chat-service

1:1 messaging app tier (`specs/messaging.spec.md`). Owns conversations, messages
and a local friends read-model; it is **queue-driven**, not request-driven.

## Responsibilities

- **Inbound work queue** (`chat.inbound`, competing consumers): each client
  `message.send` is gated, persisted with a server UUIDv7, then fanned out.
- **Send path** (`SendMessage`): gate (active friends for a _new_ conversation;
  `open` state for an _existing_ one) → lazy get-or-create conversation →
  idempotent persist on `(sender_id, client_msg_id)` → publish outbound frames
  (`message.received` to the recipient, `message.sent` ack to the sender, an echo
  to the sender's other devices). A gated/invalid send is bounced as
  `message.rejected`.
- **Friend events** (`domain.events` topic → `chat.friend-events`): folds
  `friend_request.accepted` / `friendship.removed` into `friends_read_model`
  last-writer-wins by `eventId` (idempotent, reorder-safe), and closes/reopens
  the pair's conversation (un-friend revocation / re-friend).
- **History** (`GET /chat/conversations/:id/messages`): UUIDv7-cursor pagination,
  most-recent-first, participant-only.

The gateway is a dumb relay: it stamps `senderId` and publishes to the inbound
queue, and forwards outbound frames from the per-user Redis channel `user:{id}`.

## Layout (clean architecture)

- `domain/` — `Message`, `Conversation` (canonical pair, open/closed), errors.
- `application/` — use cases (`SendMessage`, `GetHistory`, `ApplyFriendAccepted`,
  `ApplyFriendRemoved`) + ports.
- `infrastructure/` — Drizzle repos + migrations, Redis outbound publisher,
  RabbitMQ consumers (via `@hsc/platform`).
- `interface/` — queue handlers (inbound + friend events) and the HTTP history
  route.

## Scripts

```bash
pnpm dev          # tsx watch (loads .env)
pnpm test         # vitest acceptance suite (in-memory fakes)
pnpm lint         # tsc --noEmit
pnpm db:generate  # drizzle-kit generate
pnpm db:migrate   # drizzle-kit migrate
```
