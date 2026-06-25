import { useLayoutEffect, useRef, useState } from 'react'
import { useLogs, type LogEntry } from '../../features/logs/LogContext'
import { clockSeconds } from '../../lib/format'

/** On-brand colour per service tier (citrus-noir: warm hues, no blue/purple). */
const SOURCE_COLOR: Record<string, string> = {
  'ws-gateway': '#cdf24a',
  'chat-service': '#f0b429',
  'auth-service': '#8be04a',
  'social-service': '#e0913a',
}
const sourceColor = (source: string): string => SOURCE_COLOR[source] ?? '#a6a394'

/**
 * The activity log: a collapsible console pinned to the bottom of the shell.
 * Every line is tagged with the instance that handled it, so sending a few
 * messages or refreshing a token visibly lands on different replicas — the whole
 * point of the exercise. Ephemeral; "Clear" wipes the buffer.
 */
export function LogConsole() {
  const { entries, instances, clear } = useLogs()
  const [open, setOpen] = useState(false)

  return (
    <section className="shrink-0 bg-bar" aria-label="Activity log">
      <header className="flex items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-fg-muted transition-colors hover:text-fg"
          aria-expanded={open}
        >
          <Chevron open={open} />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Activity</span>
        </button>

        <span className="font-mono text-[10.5px] text-fg-faint">
          {entries.length} {entries.length === 1 ? 'event' : 'events'}
        </span>

        {instances.length > 0 && (
          <span className="font-mono text-[10.5px] text-accent" title={instances.join('\n')}>
            {instances.length} {instances.length === 1 ? 'instance' : 'instances'} discovered
          </span>
        )}

        <span className="flex-1" />

        {entries.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="font-mono text-[10.5px] text-fg-faint transition-colors hover:text-fg-muted"
          >
            Clear
          </button>
        )}
      </header>

      {open && <LogList entries={entries} />}
    </section>
  )
}

function LogList({ entries }: { entries: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  // Track whether the user is scrolled to the bottom; only autoscroll if so, so
  // reading older lines isn't yanked away by new arrivals.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  useLayoutEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <div className="px-4 pb-4 pt-1">
        <p className="font-mono text-[11px] text-fg-faint">
          Waiting for activity — send a message or add a friend to see which instance handles it.
        </p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="max-h-52 overflow-y-auto px-2 pb-2">
      <ul className="flex flex-col gap-0.5">
        {entries.map((e) => (
          <LogRow key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  const color = sourceColor(entry.source)
  return (
    <li className="flex items-baseline gap-2.5 rounded-md px-2 py-1 hover:bg-panel-2">
      <time className="shrink-0 font-mono text-[10.5px] tabular-nums text-fg-faint">
        {clockSeconds(entry.at)}
      </time>
      <span
        className="shrink-0 rounded-sm px-1.5 py-px font-mono text-[10.5px] font-medium"
        style={{ color, backgroundColor: `${color}1f` }}
      >
        {entry.instance}
      </span>
      <span className="font-mono text-[11.5px] text-fg">{entry.event}</span>
    </li>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <path d="M4.5 2.5L8 6l-3.5 3.5" />
    </svg>
  )
}
