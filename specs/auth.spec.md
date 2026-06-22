# Feature Spec — Authentication

> **Template note:** this is the first feature spec and sets the mold for the rest. Every feature spec has three sections: **Requirements** (the _what_ — tech-agnostic, testable), **Design** (the _how_ — references the chosen stack), and **Tasks** (the build, each tied back to acceptance criteria). Upstream input: `REQUIREMENTS.md` §1.

---

## 1. Requirements (the _what_)

### User stories

- **US-1** — As a new user, I want to create an account with email + password so I can use the chat.
- **US-2** — As a registered user, I want to log in so I receive credentials for the API and the WebSocket connection.
- **US-3** — As a connecting client, I want my WebSocket connection authenticated so only I can act as me.
- **US-4** — As a logged-in user, I want my session to survive access-token expiry without re-entering my password.
- **US-5** — As a user, I want to log out so my session can no longer be used.

### Acceptance criteria

**Registration**

- **AC-R1** — The system SHALL accept a registration with a unique email and a policy-compliant password, create the user with a server-assigned UUIDv7, store only an Argon2id hash of the password, and return `201`.
- **AC-R2** — WHEN the email is already registered, the system SHALL reject with `409` and SHALL NOT create a user.
- **AC-R3** — WHEN the password fails policy (e.g. min length), the system SHALL reject with `422` and SHALL NOT create a user.
- **AC-R4** — The system SHALL NOT store or log the plaintext password anywhere.

**Login**

- **AC-L1** — WHEN credentials are valid, the system SHALL return an access token, a refresh token, and `200`.
- **AC-L2** — WHEN credentials are invalid (unknown email OR wrong password), the system SHALL reject with `401` and a single generic message that does not reveal which field was wrong.
- **AC-L3** — The access token SHALL carry the user id and an expiry and SHALL be verifiable without a database lookup.

**WebSocket handshake auth**

- **AC-W1** — Immediately after the socket opens, the client SHALL send an auth frame carrying the access token as its first message.
- **AC-W2** — The gateway SHALL verify the token locally (signature + expiry), WITHOUT calling the app tier, and only then register the connection and presence.
- **AC-W3** — WHEN no valid auth frame arrives within 5 s (the auth timeout), the gateway SHALL close the socket with code `4408` and SHALL NOT register it.
- **AC-W4** — WHEN the token is missing, malformed, expired, or has an invalid signature, the gateway SHALL close with code `4401` and SHALL NOT register it.
- **AC-W5** — The authenticated user id SHALL become the connection's identity used for presence and routing.

**Token refresh**

- **AC-T1** — WHEN a valid, unexpired, unrevoked refresh token is presented, the system SHALL issue a new access token, rotate the refresh token (issue new, revoke old), and return `200`.
- **AC-T2** — WHEN the refresh token is expired, revoked, or unknown, the system SHALL reject with `401`.
- **AC-T3** — The system SHALL store only a hash of each refresh token.
- **AC-T4** — WHEN a refresh token that has already been used or revoked is presented again, the system SHALL treat it as token theft, revoke the entire token family, and reject with `401`.

**Logout**

- **AC-O1** — WHEN a user logs out, the system SHALL revoke the associated refresh-token family so it cannot be reused; outstanding access tokens remain valid until natural expiry (which is why they are short-lived).

**Long-lived connection behavior** _(the distributed-systems-specific part)_

- **AC-C1** — The gateway SHALL authenticate at handshake only; an established connection SHALL persist for its lifetime even if the access token later expires.
- **AC-C2** — On reconnect, the client SHALL present a fresh access token (refreshing it first if expired), so re-auth happens naturally per connection. (Ties to `REQUIREMENTS.md` §8 reconnect/resync.)

### Non-functional

- Passwords hashed with **Argon2id**.
- Auth endpoints over HTTPS; WebSocket over WSS (TLS terminated at Nginx in deploy).
- Login errors are generic (no user-enumeration).

---

## 2. Design (the _how_)

### 2.1 Components & responsibilities

| Component                | Role in auth                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App tier** (Elysia/TS) | Owns identity. Exposes `/auth/*` HTTP endpoints, issues & verifies tokens, persists users + refresh tokens.                                           |
| **Gateway** (Go)         | Verifies access-token JWTs locally on WS connect. Never mints tokens, never reads the users table. Shares only the verification key + claim contract. |
| **Nginx**                | Routes `/auth/*` (and other HTTP) to the app upstream; routes the WS upgrade to the gateway upstream.                                                 |
| **Postgres**             | `users`, `refresh_tokens`.                                                                                                                            |

### 2.2 Token strategy _(design decision)_

- **Access token** — short-lived JWT (**10 min**). Stateless; claims: `sub` (user UUIDv7), `iat`, `exp`, `jti`.
- **Refresh token** — long-lived (**15 days**), opaque random string (not a JWT), stored **hashed** in Postgres, **rotated** on every use.
- **Rotation & reuse detection** — each login starts a refresh-token **family** (`family_id`). Every refresh issues a new token in the same family and revokes its predecessor (the predecessor's `revoked_at` is set). If a refresh token that is _already used/revoked_ is presented again, that signals theft (an attacker replayed an old token, or the legitimate token leaked): the system revokes the **entire family** and rejects, forcing a fresh login. Logout revokes the whole family too. Each device login is its own family, so killing one family does not log out other devices.
- **Signing algorithm** — start with **HS256 + shared secret** for v1 (one secret in env, read by both app and gateway). Tradeoff: a shared secret means the gateway technically _could_ mint tokens. Upgrade path: **RS256/EdDSA**, where the app holds the private key (mints) and the gateway holds only the public key (verifies, can't mint) — a cleaner separation and a good asymmetric-key lesson. Recommended: HS256 now, RS256 later.

### 2.3 Why the gateway verifies locally

Verifying the JWT inside the gateway avoids an app round-trip on every connect (and every reconnect storm), keeps the gateway stateless and off the app's hot path. The cost is that a stateless access token can't be revoked before expiry — which is precisely why access tokens are short-lived and revocation lives at the refresh layer (AC-O1).

### 2.4 WebSocket handshake auth flow

1. Client opens the socket; the gateway starts a 5 s auth timer.
2. Client sends `{ "type": "auth", "token": "<access token>" }` as the first frame.
3. Gateway verifies signature + `exp` locally. On success: cancel timer, take `sub` as identity, register the connection in its local map and presence (`SADD` + TTL), reply `{ "type": "auth_ok" }`. On failure or timeout: close with `4401` / `4408`.

_Why a first-frame instead of a header:_ browsers can't set custom headers on the WS handshake. The alternatives — token in the query string (leaks into logs) or smuggled via `Sec-WebSocket-Protocol` (hacky) — are worse. First-frame-with-timeout is the clean, browser-friendly choice.

### 2.5 Data model (Postgres / Drizzle)

| Table            | Columns                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `users`          | `id` uuidv7 PK · `email` citext unique · `password_hash` · `display_name` · `created_at`                                  |
| `refresh_tokens` | `id` uuidv7 PK · `user_id` FK · `family_id` uuidv7 · `token_hash` · `expires_at` · `revoked_at` (nullable) · `created_at` |

All ids are server-assigned UUIDv7, per the project convention.

### 2.6 API contracts

| Endpoint              | Request                            | Success                                        | Errors       |
| --------------------- | ---------------------------------- | ---------------------------------------------- | ------------ |
| `POST /auth/register` | `{ email, password, displayName }` | `201 { userId }`                               | `409`, `422` |
| `POST /auth/login`    | `{ email, password }`              | `200 { accessToken, refreshToken, expiresIn }` | `401`        |
| `POST /auth/refresh`  | `{ refreshToken }`                 | `200 { accessToken, refreshToken, expiresIn }` | `401`        |
| `POST /auth/logout`   | `{ refreshToken }`                 | `204`                                          | —            |

WS auth is the first-frame protocol in 2.4, not an HTTP endpoint.

### 2.7 Clean-architecture layering (app tier)

- **Domain** — `User` entity, `Email` / `Password` value objects, domain errors.
- **Application (use cases)** — `RegisterUser`, `AuthenticateUser`, `RefreshSession`, `RevokeSession`, depending on ports: `UserRepository`, `RefreshTokenRepository`, `PasswordHasher`, `TokenIssuer`.
- **Infrastructure** — Drizzle repositories, Argon2id hasher, JWT issuer/verifier.
- **Interface** — Elysia route handlers mapping HTTP ↔ use cases; request validation; error → status mapping.

### 2.8 Cross-language contracts

Because the app (TS) and gateway (Go) don't share code, two things are explicit contracts:

- **JWT claim shape** (`sub`, `exp`, `iat`, `jti`) — documented and versioned.
- **Signing key + token TTLs** — shared config delivered via env in docker-compose.

---

## 3. Tasks (the build)

| #       | Task                                                                                                                                                                                                                       | Covers                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **T1**  | Drizzle schema + migration for `users` and `refresh_tokens` (incl. `family_id`)                                                                                                                                            | AC-R1, AC-T3, AC-T4                |
| **T2**  | Domain layer: `User` entity, `Email`/`Password` value objects, domain errors                                                                                                                                               | AC-R3                              |
| **T3**  | Argon2id password hasher (infra) behind a `PasswordHasher` port                                                                                                                                                            | AC-R4                              |
| **T4**  | Token services: access-token JWT issuer/verifier (TS) + verifier (Go), refresh-token generator + hashing; shared claim contract + key config                                                                               | AC-L3, AC-T1–T3, AC-W2             |
| **T5**  | Use cases: `RegisterUser`, `AuthenticateUser`, `RefreshSession` (family rotation + reuse detection → revoke the whole family on replay), `RevokeSession` (revokes the family)                                              | AC-R\*, AC-L1, AC-T1, AC-T4, AC-O1 |
| **T6**  | Drizzle repositories: `UserRepository`, `RefreshTokenRepository`                                                                                                                                                           | AC-R2, AC-T\*                      |
| **T7**  | Elysia routes + validation + error→status mapping (`/register`, `/login`, `/refresh`, `/logout`)                                                                                                                           | AC-R2/R3, AC-L2, AC-T2             |
| **T8**  | Gateway WS auth: first-frame protocol, local verification, auth timer, close codes `4401`/`4408`, set connection identity                                                                                                  | AC-W1–W5, AC-C1                    |
| **T9**  | Wire config: shared JWT secret + TTLs into compose for both services; Nginx routes `/auth/*` → app, WS → gateway                                                                                                           | AC-W2, AC-C2                       |
| **T10** | Acceptance tests: one per AC (dup/weak register, generic login failure, refresh rotation, revoked-refresh rejection, replay of a used refresh token revokes the whole family, WS connect with missing/expired/valid token) | all                                |

---

## Decisions (locked)

- **Signing algorithm:** HS256 + shared secret for v1; RS256/EdDSA later.
- **Token TTLs:** access **10 min**, refresh **15 days**.
- **WS auth:** **5 s** auth-frame timeout; close codes `4401` (unauthorized) / `4408` (timeout).
- **Refresh-token reuse detection:** **in** for v1 — rotation with token families; presenting a used/revoked token revokes the whole family and forces re-login.
