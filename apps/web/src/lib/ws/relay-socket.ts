import type { ClientFrame, LinkState, ServerFrame } from './protocol'

const AUTH_TIMEOUT_MS = 5_000 // gateway closes 4408 after 5s; give up just under that
const HEARTBEAT_INTERVAL_MS = 15_000
const PONG_TIMEOUT_MS = 10_000
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 15_000

export interface RelaySocketOptions {
  url: string
  /** A fresh access token for the handshake, or null when logged out. */
  getToken: () => Promise<string | null>
  onStateChange: (state: LinkState, latencyMs?: number) => void
  onFrame: (frame: ServerFrame) => void
}

type Timer = ReturnType<typeof setTimeout>

/**
 * The single gateway WebSocket connection. Owns the full lifecycle the spec
 * cares about: first-frame auth (§2.4), application-level heartbeat with a
 * pong-timeout liveness check (§8.1), exponential-backoff-with-jitter reconnect
 * (§8.2), and focus/blur presence reporting (§5). It is framework-agnostic —
 * React state lives in the provider that drives it.
 */
export class RelaySocket {
  private ws: WebSocket | null = null
  private state: LinkState = 'offline'
  private stopped = false
  private attempt = 0
  private pingSentAt = 0
  private focused = isFocused()

  private heartbeat?: Timer
  private pongTimer?: Timer
  private authTimer?: Timer
  private reconnectTimer?: Timer

  constructor(private readonly opts: RelaySocketOptions) {}

  start(): void {
    this.stopped = false
    document.addEventListener('visibilitychange', this.onFocusChange)
    window.addEventListener('focus', this.onFocusChange)
    window.addEventListener('blur', this.onFocusChange)
    window.addEventListener('online', this.onOnline)
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    document.removeEventListener('visibilitychange', this.onFocusChange)
    window.removeEventListener('focus', this.onFocusChange)
    window.removeEventListener('blur', this.onFocusChange)
    window.removeEventListener('online', this.onOnline)
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.setState('offline')
  }

  /** Send a frame. Returns false if the socket isn't live (caller decides). */
  send(frame: ClientFrame): boolean {
    if (this.ws?.readyState === WebSocket.OPEN && this.state === 'live') {
      this.ws.send(JSON.stringify(frame))
      return true
    }
    return false
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting')

    const token = await this.opts.getToken()
    if (this.stopped) return
    if (!token) {
      // Logged out / refresh failed; the auth guard will unmount us.
      this.setState('offline')
      return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientFrame))
      // The gateway never replies to a bad/late auth — it just closes; bound the
      // wait so we don't sit in "connecting" forever.
      this.authTimer = setTimeout(() => ws.close(), AUTH_TIMEOUT_MS)
    }
    ws.onmessage = (event) => this.onMessage(event)
    ws.onclose = () => this.onClose()
    ws.onerror = () => {
      /* a 'close' always follows; handle teardown there */
    }
  }

  private onMessage(event: MessageEvent): void {
    let frame: ServerFrame
    try {
      frame = JSON.parse(event.data as string) as ServerFrame
    } catch {
      return
    }

    if (frame.type === 'auth_ok') {
      clearTimeout(this.authTimer)
      this.onAuthenticated()
      return
    }
    if (frame.type === 'pong') {
      clearTimeout(this.pongTimer)
      this.setState('live', Date.now() - this.pingSentAt)
      return
    }
    this.opts.onFrame(frame)
  }

  private onAuthenticated(): void {
    this.attempt = 0
    this.setState('live')
    // Re-establish focus on every (re)connect (§8.2). The gateway registers a new
    // connection as Idle by default, so only the focused case needs reporting —
    // re-sending `blur` would just restate the default and spam a redundant
    // presence change on each reconnect.
    if (this.focused) this.send({ type: 'focus' })
    this.startHeartbeat()
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.ping() // immediate, so latency shows the moment we go live
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_INTERVAL_MS)
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.pingSentAt = Date.now()
    this.ws.send(JSON.stringify({ type: 'ping' } satisfies ClientFrame))
    // No pong within the window => the socket is dead even if the OS thinks it's
    // open (§8.1). Close it to trigger reconnect.
    clearTimeout(this.pongTimer)
    this.pongTimer = setTimeout(() => this.ws?.close(), PONG_TIMEOUT_MS)
  }

  private onClose(): void {
    this.clearTimers()
    this.ws = null
    if (this.stopped) {
      this.setState('offline')
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting')
    this.attempt += 1
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (this.attempt - 1), BACKOFF_MAX_MS)
    const jitter = Math.random() * backoff * 0.3 // avoid a thundering herd (§8.2)
    this.reconnectTimer = setTimeout(() => void this.connect(), backoff + jitter)
  }

  private onFocusChange = (): void => {
    // The browser fires visibilitychange/focus/blur in many cases where the
    // effective focus state is unchanged; only report real transitions so we
    // don't spam the gateway (and the activity log) with redundant focus/blur
    // frames.
    const focused = isFocused()
    if (focused === this.focused) return
    this.focused = focused
    this.sendFocusState()
  }

  private sendFocusState(): void {
    this.send({ type: this.focused ? 'focus' : 'blur' })
  }

  private onOnline = (): void => {
    // Network came back — retry now instead of waiting out the backoff.
    if (this.stopped || this.state === 'live') return
    clearTimeout(this.reconnectTimer)
    this.attempt = 0
    void this.connect()
  }

  private setState(state: LinkState, latencyMs?: number): void {
    this.state = state
    this.opts.onStateChange(state, latencyMs)
  }

  private clearHeartbeat(): void {
    clearInterval(this.heartbeat)
    clearTimeout(this.pongTimer)
  }

  private clearTimers(): void {
    this.clearHeartbeat()
    clearTimeout(this.authTimer)
    clearTimeout(this.reconnectTimer)
  }
}

function isFocused(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}
