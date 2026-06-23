/**
 * Runtime client config. The whole backend is addressed under a same-origin
 * `/api` prefix (the dev proxy / edge strips it before forwarding), so the SPA
 * keeps the rest of the path space for its own router — e.g. the `/chat/:friend`
 * route doesn't collide with the chat-service API. Override the base for a
 * cross-origin backend via VITE_API_BASE_URL.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** The gateway WebSocket endpoint. Derived from the page origin unless overridden. */
export const WS_URL = import.meta.env.VITE_WS_URL ?? defaultWsUrl()

function defaultWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8080/api/ws'
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/api/ws`
}
