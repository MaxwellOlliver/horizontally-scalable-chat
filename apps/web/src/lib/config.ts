/** Runtime client config. Empty base => same-origin relative URLs (dev proxy). */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/** The gateway WebSocket endpoint. Derived from the page origin unless overridden. */
export const WS_URL = import.meta.env.VITE_WS_URL ?? defaultWsUrl()

function defaultWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8080/ws'
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws`
}
