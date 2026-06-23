import type { PresenceStatus } from '../../lib/ws/protocol'

const PRESENCE: Record<PresenceStatus, { dot: string; label: string }> = {
  online: { dot: 'bg-live', label: 'Online' },
  idle: { dot: 'bg-idle', label: 'Idle' },
  offline: { dot: 'bg-down', label: 'Offline' },
}

/** A small presence indicator: a colored dot, optionally with its label. */
export function PresenceDot({
  status,
  withLabel = false,
}: {
  status: PresenceStatus
  withLabel?: boolean
}) {
  const { dot, label } = PRESENCE[status]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {withLabel && <span className="text-[11px] text-fg-muted">{label}</span>}
    </span>
  )
}
