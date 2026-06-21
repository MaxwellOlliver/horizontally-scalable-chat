# @hsc/ws-gateway-go

WebSocket gateway (Go). Authenticates each connection **at handshake** by
verifying the access-token JWT **locally** — it never mints tokens and never
reads the users table (spec [`auth.spec.md`](../../specs/auth.spec.md) §2.1–2.4,
task **T8**).

A `package.json` wraps the Go toolchain so Turborepo drives it like any other
workspace (`pnpm build` → `go build`, `pnpm test` → `go test`, etc.).

## Handshake-auth protocol (spec §2.4)

1. Client opens the socket to `/ws`; the gateway starts a **5 s** auth timer.
2. Client sends the **first frame**:
   ```json
   { "type": "auth", "token": "<access token>" }
   ```
3. The gateway verifies signature + `exp` + `iss` locally (HS256, shared secret).
   - **Success** → cancel the timer, take `sub` as the connection identity,
     register the connection, reply `{ "type": "auth_ok" }`.
   - **Bad/missing/expired/mis-signed token** → close **4401**.
   - **No valid frame within the timeout** → close **4408**.

Once authenticated the connection persists for its lifetime; the token is **not**
re-checked mid-connection (access tokens are short-lived, so revocation lives at
the refresh layer in the app tier).

## Presence (REQUIREMENTS §5)

After `auth_ok`, the connection drives **cross-instance presence** in Redis, so a
user's status is visible from any gateway replica (the basis for horizontal
scaling). Post-auth frames:

| Frame                 | Effect                                                        |
| --------------------- | ------------------------------------------------------------ |
| `{"type":"ping"}`     | reply `{"type":"pong"}` + refresh presence TTL (§8.1)        |
| `{"type":"focus"}`    | connection → **Online** (§5.1)                              |
| `{"type":"blur"}`     | connection → **Idle**                                        |

A freshly authenticated socket is **Idle**, not Online — a live socket alone is
not "online" (§5.1). The **effective** status is the most-present state across
all of a user's connections (Online > Idle > Offline, §5.2 multi-device).

**Redis model** (a plain SET can't give per-member TTL, so):

- `presence:user:{userId}` — ZSET, `member=connId`, `score=expiry-ms`. Liveness +
  enumeration; `ZREMRANGEBYSCORE 0 now` prunes dead connections (self-healing if a
  whole gateway dies, §5.3).
- `presence:conn:{connId}` — focus state (`online`/`idle`), TTL'd, refreshed by
  heartbeat.

Presence is **best-effort**: if Redis is unavailable the socket still works
(auth never depends on it). Read a user's status via `GET /presence/{userId}` →
`{ "userId": "...", "status": "online|idle|offline" }`.

Tested against in-process `miniredis` (`internal/presence`) and over real WS
round-trips (`internal/ws`).

## Acceptance criteria → code / tests

| AC    | Where                                                            |
| ----- | --------------------------------------------------------------- |
| AC-W1 | first-frame protocol — `internal/ws/handler.go` `authenticate`  |
| AC-W2 | local verify, register only after success — `handler.go`, `internal/auth` |
| AC-W3 | 5 s timer → close 4408 — `TestAuthTimeoutCloses4408`            |
| AC-W4 | missing/malformed/expired/bad-sig → 4401 — `handler_test.go`    |
| AC-W5 | `sub` as identity in the registry — `TestValidTokenAuthenticatesAndRegisters` |
| AC-C1 | connection persists past auth timeout — `TestConnectionPersistsAfterAuth` |

## Cross-language contract (spec §2.8)

`JWT_SECRET` and `JWT_ISSUER` **must** match the auth-service. The gateway only
verifies; it shares the secret (HS256 v1) but never issues tokens. See
[`.env.example`](./.env.example).

## Scripts

| Command      | Runs                                       |
| ------------ | ------------------------------------------ |
| `pnpm dev`   | `go run ./cmd/gateway`                     |
| `pnpm build` | `go build -o dist/ws-gateway-go ./cmd/gateway` |
| `pnpm start` | run the compiled binary                    |
| `pnpm lint`  | `go vet ./...`                             |
| `pnpm test`  | `go test ./...`                            |

## Layout

```
cmd/gateway/main.go        config → verifier → registry → HTTP (/ws, /presence, /health)
internal/config            env loading + validation
internal/auth              HS256 local JWT verification (the AC-W2 core)
internal/registry          userID → connections (gateway-local identity, AC-W5)
internal/presence          Redis-backed cross-instance presence (§5)
internal/ws                first-frame protocol, auth timer, close codes, presence frames
```

## Deferred

- **§5.4 — friends see presence changes in real time.** Needs friends (§2) +
  Redis pub/sub fan-out; `internal/presence` already exposes `Effective` as the
  read hook a publisher will use.
- Client-side focus/heartbeat reporting (lives in the client app).
- Message routing / fan-out (§3), reconnect-resync (§8).
- RS256/EdDSA upgrade (spec §2.2 upgrade path).
