# horizontally-scalable-chat
The goal of this project is to explore how to work with WebSockets in a distributed-systems environment — specifically, how a connection that lives on one instance can still reach a user connected to another.

<img width="1440" height="760" alt="image" src="https://github.com/user-attachments/assets/96657716-1500-451d-99d2-a59c2d87c85f" />

## Running

Copy `.env.example` to `.env` (it must set `JWT_SECRET`), then bring up the stack.

```bash
# Single instance per tier
docker compose up -d --build

# Scaled — multiple replicas per tier (see them in the client's Activity log)
docker compose up -d --build --force-recreate \
  --scale auth-service=2 --scale social-service=2 \
  --scale chat-service=2 --scale ws-gateway-go=2

# Client
pnpm --filter @hsc/web dev   # http://localhost:5173
```

Notes:
- `--scale` is **not** persisted — pass the flags on *every* `docker compose up`, or it reverts to one replica each.
- Bring the gateway replicas up together: nginx resolves the `least_conn` gateway pool once at boot. If you rebuild a gateway replica afterwards, recreate nginx: `docker compose up -d --force-recreate --no-deps nginx`.
