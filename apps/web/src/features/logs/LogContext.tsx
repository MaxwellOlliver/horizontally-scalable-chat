import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useWebSocket } from '../../lib/ws/WebSocketProvider'

/** One observability line: which instance did what, for this user. */
export interface LogEntry {
  id: number
  instance: string
  source: string
  event: string
  at: string
}

interface LogContextValue {
  entries: LogEntry[]
  /** Distinct instance ids seen this session — the headline "it's scaling" stat. */
  instances: string[]
  clear: () => void
}

const LogContext = createContext<LogContextValue | null>(null)

/** The live log is ephemeral — only the most recent lines are kept in memory. */
const CAP = 200

/**
 * Collects `log` frames from the gateway into a bounded in-memory buffer. These
 * lines come from every tier (auth/social/chat + gateway), tagged with the
 * instance that handled the work, so the panel shows the horizontally-scaled
 * request path spreading across instances. No persistence by design.
 */
export function LogProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    return subscribe((frame) => {
      if (frame.type !== 'log') return
      const entry: LogEntry = {
        id: nextId.current++,
        instance: frame.data.instance,
        source: frame.data.source,
        event: frame.data.event,
        at: frame.data.at,
      }
      setEntries((prev) => {
        const next = prev.length >= CAP ? prev.slice(prev.length - CAP + 1) : prev
        return [...next, entry]
      })
    })
  }, [subscribe])

  const clear = useCallback(() => setEntries([]), [])

  const value = useMemo<LogContextValue>(() => {
    const instances = [...new Set(entries.map((e) => e.instance))].sort()
    return { entries, instances, clear }
  }, [entries, clear])

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>
}

export function useLogs(): LogContextValue {
  const ctx = useContext(LogContext)
  if (!ctx) throw new Error('useLogs must be used within LogProvider')
  return ctx
}
