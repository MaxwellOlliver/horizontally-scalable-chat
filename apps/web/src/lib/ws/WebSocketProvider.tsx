import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WS_URL } from '../config'
import { ensureAccessToken } from '../auth/refresh'
import { applyFrameToCache } from './cache-sync'
import { RelaySocket } from './relay-socket'
import type { ClientFrame, LinkState, ServerFrame } from './protocol'

export interface WebSocketContextValue {
  linkState: LinkState
  latencyMs?: number
  /** Send a frame; false if the socket isn't live. */
  send: (frame: ClientFrame) => boolean
  /** Receive every inbound frame; returns an unsubscribe. */
  subscribe: (listener: (frame: ServerFrame) => void) => () => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

/**
 * Owns the single gateway connection for the authenticated session. Drives the
 * RelaySocket, exposes its link state + latency (for the header instrument and
 * offline tip), a `send`, and a frame subscription. Inbound frames also feed the
 * query cache so the sidebar lists stay live.
 */
export function WebSocketProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [linkState, setLinkState] = useState<LinkState>('connecting')
  const [latencyMs, setLatencyMs] = useState<number>()
  const socketRef = useRef<RelaySocket | null>(null)
  const listenersRef = useRef(new Set<(frame: ServerFrame) => void>())

  useEffect(() => {
    const socket = new RelaySocket({
      url: WS_URL,
      getToken: ensureAccessToken,
      onStateChange: (state, latency) => {
        setLinkState(state)
        if (latency !== undefined) setLatencyMs(latency)
      },
      onFrame: (frame) => {
        applyFrameToCache(qc, frame)
        for (const listener of listenersRef.current) listener(frame)
      },
    })
    socketRef.current = socket
    socket.start()
    return () => {
      socket.stop()
      socketRef.current = null
    }
  }, [qc])

  const value = useMemo<WebSocketContextValue>(
    () => ({
      linkState,
      latencyMs,
      send: (frame) => socketRef.current?.send(frame) ?? false,
      subscribe: (listener) => {
        listenersRef.current.add(listener)
        return () => {
          listenersRef.current.delete(listener)
        }
      },
    }),
    [linkState, latencyMs],
  )

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider')
  return ctx
}
