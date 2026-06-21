# @hsc/auth-service

Identity / auth tier for the chat platform — an [Elysia](https://elysiajs.com) app
running on Node via the `@elysiajs/node` adapter. Owns `/auth/*` HTTP endpoints and
issues/verifies tokens. See [`specs/auth.spec.md`](../../specs/auth.spec.md) for the
full design.

## Scripts

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `pnpm dev`      | Run with hot reload (`tsx watch`)             |
| `pnpm build`    | Type-check + compile to `dist/` (`tsc`)       |
| `pnpm start`    | Run the compiled server (`node dist/index.js`)|
| `pnpm lint`     | Type-check only (`tsc --noEmit`)              |
| `pnpm test`     | Placeholder until tests land                  |

`PORT` selects the listen port (default `3000`).

```bash
pnpm --filter @hsc/auth-service dev
curl http://localhost:3000/health
```

## Status

Scaffold only: a `/health` endpoint and the wiring. Auth routes
(`register` / `login` / `refresh` / `logout`) get built out per the spec's task list.
