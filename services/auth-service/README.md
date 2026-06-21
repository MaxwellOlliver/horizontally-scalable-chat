# @hsc/auth-service

Identity / auth tier for the chat platform — an [Elysia](https://elysiajs.com) app
running on Node via the `@elysiajs/node` adapter. Owns the `/auth/*` HTTP
endpoints, issues & verifies access tokens, and persists users + refresh tokens.
See [`specs/auth.spec.md`](../../specs/auth.spec.md) for the full design.

## Endpoints (spec §2.6)

| Endpoint              | Request                            | Success                                        | Errors       |
| --------------------- | ---------------------------------- | ---------------------------------------------- | ------------ |
| `POST /auth/register` | `{ email, password, displayName }` | `201 { userId }`                               | `409`, `422` |
| `POST /auth/login`    | `{ email, password }`              | `200 { accessToken, refreshToken, expiresIn }` | `401`        |
| `POST /auth/refresh`  | `{ refreshToken }`                 | `200 { accessToken, refreshToken, expiresIn }` | `401`        |
| `POST /auth/logout`   | `{ refreshToken }`                 | `204`                                          | —            |

WebSocket handshake auth (the first-frame protocol, spec §2.4) lives in the Go
gateway and is **not** built here yet — the app tier is completed and tested first.

## Architecture (clean-architecture layers, spec §2.7)

```
src/
  config/env.ts                  validated runtime config (zod)
  domain/                        entities, value objects, errors (no I/O)
    user.ts · refresh-token.ts · errors.ts · value-objects/{email,password}.ts
  application/
    ports/                       UserRepository, RefreshTokenRepository,
                                 PasswordHasher, TokenIssuer, RefreshTokenService,
                                 Clock, IdGenerator
    session.ts                   shared access+refresh issuing
    use-cases/                   RegisterUser · AuthenticateUser ·
                                 RefreshSession · RevokeSession
  infrastructure/
    db/                          Drizzle schema + migrations + client
    security/                    Argon2id hasher · HS256 JWT issuer · sha256 refresh
    repositories/                Drizzle UserRepository / RefreshTokenRepository
    id/                          UUIDv7 generator
  interface/http/                zod validation · error→status mapping · routes
  composition-root.ts            wires ports → adapters → use cases
  app.ts · index.ts              Elysia app factory + entry point
```

Security invariants enforced: only Argon2id password hashes are stored; only
SHA-256 hashes of refresh tokens are stored; refresh tokens rotate on every use
with token-family reuse detection; login errors are generic (no enumeration);
access tokens are stateless HS256 JWTs verifiable without a DB lookup; no
plaintext password / refresh token / access token is ever logged.

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `pnpm dev`         | Run with hot reload (`tsx watch`)             |
| `pnpm build`       | Type-check + compile to `dist/` (`tsc`)       |
| `pnpm start`       | Run the compiled server (`node dist/index.js`)|
| `pnpm lint`        | Type-check only (`tsc --noEmit`)              |
| `pnpm test`        | Run the acceptance + unit suite (Vitest)      |
| `pnpm db:generate` | Generate a Drizzle migration from the schema  |
| `pnpm db:migrate`  | Apply migrations to `DATABASE_URL`            |

Configure via env (see [`.env.example`](./.env.example)); `JWT_SECRET` + the TTLs
are a shared contract with the gateway (spec §2.8).

## Acceptance tests → AC mapping (spec §1)

Tests in `src/__tests__/acceptance` drive the real use-case wiring and Elysia
routes over in-memory fakes (the real Argon2id adapter is covered separately):

| File                  | Acceptance criteria                          |
| --------------------- | -------------------------------------------- |
| `registration.test.ts`| AC-R1, AC-R2, AC-R3, AC-R4                   |
| `login.test.ts`       | AC-L1, AC-L2, AC-L3                          |
| `refresh.test.ts`     | AC-T1, AC-T2, AC-T3, AC-T4                   |
| `logout.test.ts`      | AC-O1                                        |
| `validation.test.ts`  | §2.6 request validation → 422               |

WS criteria (AC-W*, AC-C*) are deferred to the gateway task (T8).
