# Infra — local auth stack (T9)

`docker-compose.yml` (repo root) brings up the auth slice end-to-end:

```
            ┌─────────── Nginx :${HTTP_PORT} ───────────┐
  client ──▶│  /auth/*  ─▶ auth-service:3000 (app tier) │
            │  /ws      ─▶ ws-gateway-go:8080 (verify)   │
            └────────────────────────────────────────────┘
                 auth-service ─▶ postgres:5432
                 ws-gateway-go ─▶ redis:6379  (presence, §5)
```

## Run

```bash
cp .env.example .env          # then set a real JWT_SECRET (>=32 chars)
docker compose up --build
```

Startup order is enforced: `postgres` (healthcheck) → `migrate` (applies Drizzle
migrations, runs once) → `auth-service`; `ws-gateway-go` and `nginx` come up
alongside.

## Smoke test

```bash
PORT=${HTTP_PORT:-8080}
curl -s localhost:$PORT/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"a-strong-password","displayName":"A"}'
# -> 201 {"userId":"..."}

curl -s localhost:$PORT/auth/login -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"a-strong-password"}'
# -> 200 {"accessToken":"...","refreshToken":"...","expiresIn":600}
```

Then open `ws://localhost:$PORT/ws` and send the access token as the first frame
(`{"type":"auth","token":"<accessToken>"}`) → `{"type":"auth_ok"}`. After that,
send `{"type":"focus"}` and check presence:

```bash
curl -s localhost:$PORT/presence/<userId>   # -> {"userId":"...","status":"online"}
```

`{"type":"ping"}`→`{"type":"pong"}` refreshes the presence TTL; `{"type":"blur"}`
drops to `idle`; closing the socket (or a missed heartbeat) → `offline`.

## The cross-language contract (spec §2.8)

`JWT_SECRET` and `JWT_ISSUER` are defined once in `.env` and injected into **both**
`auth-service` and `ws-gateway-go`. That shared HS256 secret is exactly what lets
the gateway verify access tokens locally — no app-tier round-trip (AC-W2). The
access/refresh **TTLs** go to the app tier (it mints); the gateway only needs the
secret + issuer to verify `exp`/`iss`.

TLS/WSS terminate at Nginx in deploy; this local config is plain `:80` behind the
published `HTTP_PORT` (see `nginx.conf` for the `listen 443 ssl;` upgrade note).
