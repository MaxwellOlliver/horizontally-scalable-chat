# @hsc/web

Relay — the chat client. Vite + React + TypeScript + Tailwind v4, dark-only, an
"operator console" visual language (square panels, hairline borders, Geist
Sans/Mono, a live link-state instrument).

## Dev

```bash
pnpm --filter @hsc/web dev      # http://localhost:5173
```

The dev server proxies `/auth`, `/social`, `/chat`, `/presence`, `/ws` to the
backend (default `http://localhost:8080`, the Nginx front door). Override the
target with `VITE_PROXY_TARGET` in `.env.local`.

## Layout

- `src/lib/` — `config.ts` (API/WS URLs), `api.ts` (shared Axios client).
- `src/components/` — shared UI; `ConnectionStatus` is the link-state instrument.
- `src/index.css` — design tokens (`@theme`) + base layer.

## Build

```bash
pnpm --filter @hsc/web build    # tsc -b && vite build
pnpm --filter @hsc/web lint     # tsc --noEmit
```
