import type { LinkState } from '../lib/ws/protocol'

/**
 * The link-state instrument — Relay's signature element. It reports the live
 * socket state the way the system actually thinks about it: a status light, a
 * machine-readable label, and (when live) the heartbeat round-trip. Bound to the
 * WebSocket context in the authed shell.
 */

const COPY: Record<LinkState, { label: string; tone: string; dot: string }> = {
  connecting: { label: 'CONNECTING', tone: 'text-idle', dot: 'bg-idle' },
  live: { label: 'LIVE', tone: 'text-live', dot: 'bg-live' },
  reconnecting: { label: 'RECONNECTING', tone: 'text-idle', dot: 'bg-idle' },
  offline: { label: 'OFFLINE', tone: 'text-down', dot: 'bg-down' },
}

export function ConnectionStatus({ state, latencyMs }: { state: LinkState; latencyMs?: number }) {
  const { label, tone, dot } = COPY[state]
  return (
    <div className="flex items-center gap-2 rounded-full bg-rail px-3 py-1.5">
      <span className={`relative inline-flex h-2 w-2 ${tone}`}>
        {state === 'live' && <span className="relay-pulse absolute inset-0" />}
        <span className={`h-2 w-2 rounded-full ${dot}`} />
      </span>
      <span className={`font-mono text-[11px] font-medium tracking-[0.12em] ${tone}`}>{label}</span>
      <span className="font-mono text-[11px] text-fg-faint">
        {state === 'live' ? `${latencyMs ?? '—'}ms` : 'no link'}
      </span>
    </div>
  )
}
