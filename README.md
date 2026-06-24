<p align="center">
  <img src="docs/images/logo.svg" alt="Relay" width="180" />
</p>

<p align="center">
  A horizontally-scalable real-time chat
  <br />
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square" />
  <img alt="React" src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB&style=flat-square" />
  <img alt="Go" src="https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white&style=flat-square" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white&style=flat-square" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white&style=flat-square" />
  <img alt="Redis" src="https://img.shields.io/badge/Redis-FF4438?logo=redis&logoColor=white&style=flat-square" />
  <img alt="RabbitMQ" src="https://img.shields.io/badge/RabbitMQ-FF6600?logo=rabbitmq&logoColor=white&style=flat-square" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white&style=flat-square" />
</p>

<p align="center">
  <img width="900" alt="Relay — real-time chat UI" src="docs/images/hero.png" />
</p>

<p align="center">
  <em>1:1 messaging · delivery &amp; read receipts · focus-driven presence · typing · reconnect &amp; resync — across N gateway replicas.</em>
</p>

> Exploring how a WebSocket connection that lives on **one** server instance can still
> reach a user connected to a **different** one — the core problem of running real-time
> chat behind more than one box.

---

## Contents

- [Why this exists](#why-this-exists)
- [Feature tour](#feature-tour)
- [Architecture](#architecture)
- [The life of a message](#the-life-of-a-message)
- [Horizontal scaling](#horizontal-scaling)
- [Tech stack](#tech-stack)
- [Running it](#running-it)
- [Project layout](#project-layout)
- [Further reading](#further-reading)

---

## Why this exists

A single chat server is easy: every socket is in the same process, so delivering a message
is a local lookup. The moment you run **two** gateways behind a load balancer, that
assumption breaks — the sender's socket is on gateway α, the recipient's is on gateway β,
and neither can see the other's connections.

Relay is a deliberately small (1:1 only) but **fully horizontally-scaled** chat that solves
exactly that distributed real-time path:

- **Stateless gateways** — a client may land on any replica and simply re-register; no
  sticky sessions.
- **Cross-instance delivery** over Redis Pub/Sub — the gateway holding the recipient's
  socket gets the message, wherever it lives.
- **An async send path** — clients publish to a RabbitMQ work queue that the chat service
  consumes with competing consumers, so message persistence scales independently of the
  socket layer.
- **Presence, receipts, typing, and reconnect/resync** all designed to survive replicas
  coming and going.

Group chat, message edit/delete, and search are intentionally out of scope — see
[`REQUIREMENTS.md`](./REQUIREMENTS.md) for the full scoped spec and the conscious
non-goals.

---

## Feature tour

| | |
|---|---|
| **Receipts** — `sent → delivered → seen`, each checkmark computed locally from per-conversation high-water marks. | <img src="docs/images/receipt.gif" width="164" alt="delivery and read receipts" /> |
| **Presence** — focus-driven `online / idle / offline` (a live socket alone isn't "online"), with multi-device precedence. | <img src="docs/images/presence.gif" width="164" alt="presence states" /> |
| **Typing** — a debounced, ephemeral signal with a timeout fallback. | <img src="docs/images/typing.gif" width="236" alt="typing indicator" /> |

Plus optimistic **messaging** with durable UUIDv7-ordered history, and **reconnect &
resync** (backoff + jitter, cursor catch-up, dedupe by id) — see
[Architecture](#architecture) and [`REQUIREMENTS.md`](./REQUIREMENTS.md).

### Watch it scale

Every event is tagged with the **replica that handled it**, so sending a few messages or
refreshing a token visibly lands on different instances — the whole point of the project:

<p align="center">
  <img src="docs/images/activity-log.gif" width="900" alt="Activity log showing events handled across multiple instances" />
</p>

---

## Architecture

The diagram shows the intended **cloud** topology: an L4 **NLB** for long-lived
WebSockets, an L7 **ALB** for stateless HTTP, a pool of WebSocket gateways, and the
real-time core (Redis + RabbitMQ) wiring it all together.

```mermaid
flowchart LR
  Users(["Users"])

  subgraph edge["Edge · Load Balancing"]
    NLB["NLB · L4<br/>least-conn"]
    APIGW["API Gateway"]
    ALB["ALB · L7<br/>round-robin"]
  end

  subgraph realtime["Real-time Core"]
    direction TB
    WS["WebSocket Gateway ×N<br/>stateless · any replica"]
    MQ{{"RabbitMQ"}}
    REDIS[("Redis<br/>presence + pub/sub")]
  end

  subgraph services["Services & Data"]
    AUTH["Auth service"] --> AUTHDB[("Auth DB")]
    SOCIAL["Social service"] --> SOCIALDB[("Social DB")]
    CHAT["Chat service"] --> CHATDB[("Chat DB")]
  end

  Users -->|WebSocket| NLB
  Users -->|REST /api| APIGW
  NLB --> WS
  APIGW --> ALB
  ALB --> AUTH
  ALB --> SOCIAL
  ALB --> CHAT

  WS -->|presence + heartbeat TTL| REDIS
  WS -->|publish inbound message| MQ
  MQ --> CHAT
  CHAT -->|fan-out delivery| REDIS
  REDIS -->|push to recipient's socket| WS
  SOCIAL -->|friend domain events| MQ

  classDef store fill:#fdecea,stroke:#c0392b,color:#7b241c;
  classDef broker fill:#fff3e0,stroke:#d35400,color:#7e3f00;
  classDef svc fill:#eef2ff,stroke:#4f46e5,color:#312e81;
  classDef edgecls fill:#f4f4f5,stroke:#71717a,color:#27272a;

  class REDIS,AUTHDB,SOCIALDB,CHATDB store;
  class MQ broker;
  class WS,AUTH,SOCIAL,CHAT svc;
  class NLB,APIGW,ALB edgecls;
```

> **Cloud-idiomatic, simulated locally.** For study purposes the repo collapses the NLB +
> API Gateway + ALB into a **single nginx** edge that plays both roles — L7 routing for
> `/auth /social /chat` (Docker-DNS round-robin) and an L4-style `least_conn` upstream for
> `/ws` — and every tier scales with `docker compose --scale`, with the instance ids
> surfacing live in the app's Activity log.

**The pieces:**

| Component | Role |
|---|---|
| **WebSocket gateway** (Go) | Terminates client sockets, runs first-frame JWT auth, heartbeat, presence, and the inbound/outbound message bridge. Stateless and replicated. |
| **Auth service** | Issues & verifies JWTs, owns users + refresh tokens. The gateway verifies the *same* token locally (shared secret) — no per-message call to auth. |
| **Social service** | Friend requests & friendships; emits domain events to RabbitMQ and pushes live list updates via Redis. |
| **Chat service** | Consumes the inbound work queue + friend events; owns conversations/messages and the friends read-model; serves history. |
| **Redis** | Presence registry (with heartbeat TTL) **and** per-user Pub/Sub delivery channels. |
| **RabbitMQ** | The inbound message work queue (competing consumers) + the `domain.events` topic exchange. |
| **nginx** | The single local edge that stands in for the NLB/ALB split. |

---

## The life of a message

The headline mechanic: Alice and Bob are on **different gateways**, yet the message (and
the receipt that flows back) reaches the right socket via Redis Pub/Sub.

```mermaid
sequenceDiagram
  actor A as Alice
  participant GA as Gateway α
  participant MQ as RabbitMQ
  participant CS as Chat service
  participant R as Redis Pub/Sub
  participant GB as Gateway β
  actor B as Bob

  A->>GA: message.send (clientMsgId, body)
  GA->>MQ: publish to inbound work queue
  MQ->>CS: consume (competing consumers)
  CS->>CS: persist · assign UUIDv7 + timestamp
  CS->>R: publish ack → user:alice
  R->>GA: message.sent
  GA-->>A: sent ✓ (reconcile temp id → UUIDv7)
  CS->>R: publish message → user:bob
  R->>GB: deliver (Bob's socket lives on β)
  GB-->>B: message.received
  B->>GB: receipt — delivered/read up-to id
  GB->>R: publish → user:alice
  R->>GA: receipt.update
  GA-->>A: delivered ✓✓ / seen
```

Key ideas:

- **Server-assigned UUIDv7** ids are time-sortable, so they double as the ordering key
  *and* the resync cursor — no separate sequence column.
- **Receipts are high-water marks** (`delivered_up_to` / `read_up_to`), not per-message
  rows. The sender's client computes every checkmark locally; advancing a mark is `max()`,
  so retries are idempotent.
- **Offline?** The message is durably stored and delivered on reconnect via a
  `GET messages since {cursor}` catch-up, deduped by id against any live push.

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) §3–§8 for the full model (receipts, presence
precedence, reconnect/resync).

---

## Horizontal scaling

This is the whole point — bring up multiple replicas per tier and watch the work spread:

```bash
docker compose up -d --build --force-recreate \
  --scale auth-service=2 --scale social-service=2 \
  --scale chat-service=2 --scale ws-gateway-go=2
```

Each replica derives a distinct instance id from its container hostname, surfaced in the
client's **Activity log** — so sending a few messages or refreshing a token visibly lands
on different replicas.

How each tier balances:

- **HTTP tiers** (`/auth /social /chat`) — nginx re-resolves the service name via Docker
  DNS *per request*, naturally round-robining across replica A-records (and following
  containers that get a new IP on rebuild).
- **WebSocket gateways** (`/ws`) — a `least_conn` upstream, because long-lived connections
  are uneven; balancing by active-connection count beats round-robin.
- **Message persistence** — RabbitMQ competing consumers across chat-service replicas.
- **Cross-instance delivery** — Redis Pub/Sub, so location is a lookup, not a fixed
  assignment.

> ⚠️ `--scale` is **not** persisted — pass the flags on *every* `docker compose up`, or it
> reverts to one replica each. Bring the gateway replicas up together (nginx resolves the
> `least_conn` pool once at boot); if you rebuild a gateway replica afterwards, recreate
> nginx: `docker compose up -d --force-recreate --no-deps nginx`.

---

## Tech stack

| Layer | Tech |
|---|---|
| **Client** | React 19, Vite, TanStack Router + Query, Tailwind v4 (the "Relay" SPA) |
| **WebSocket gateway** | Go · gorilla/websocket |
| **Services** | Node.js + TypeScript, Drizzle ORM |
| **Data** | PostgreSQL 16 · Redis 7 · RabbitMQ 3.13 |
| **Edge** | nginx |
| **Tooling** | pnpm workspaces · Turborepo · Docker Compose |

---

## Running it

Copy `.env.example` to `.env` (it must set `JWT_SECRET`), then bring up the stack.

```bash
# Single instance per tier
docker compose up -d --build

# Scaled — multiple replicas per tier (see them in the client's Activity log)
docker compose up -d --build --force-recreate \
  --scale auth-service=2 --scale social-service=2 \
  --scale chat-service=2 --scale ws-gateway-go=2
```

Then open the web client:

- **Containerized:** http://localhost:3000 — the `web` service (nginx serving the SPA and
  proxying `/api` to the edge).
- **Dev server (hot reload):** `pnpm --filter @hsc/web dev` → http://localhost:5173

---

## Project layout

```
apps/
  web/             Relay SPA (React) + its Dockerfile/nginx front door
  ws-gateway-go/   WebSocket gateway (Go)
services/
  auth-service/    identity — JWTs, users, refresh tokens
  social-service/  friends — requests, friendships, domain events
  chat-service/    messaging — conversations, messages, history
packages/
  platform/        shared TypeScript (instance id, log stream, …)
infra/
  nginx/           edge + web front-door configs
docker-compose.yml
REQUIREMENTS.md    the scoped functional spec
```

---

## Further reading

- [`REQUIREMENTS.md`](./REQUIREMENTS.md) — the full functional spec: the receipt
  high-water-mark model, presence precedence, and the reconnect/resync contract, plus the
  conscious v1 non-goals.
