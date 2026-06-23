import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../../lib/ws/WebSocketProvider'

type Timer = ReturnType<typeof setTimeout>

// Sender: stop emitting once typing has paused this long.
const IDLE_MS = 3_000
// Receiver: clear the indicator if no further signal arrives (a dropped
// typing.stop must not leave it stuck — the spec's timeout fallback, §6.2).
const FALLBACK_MS = 6_000

/**
 * Sender side: debounced typing signals for the open conversation. `onInput`
 * emits a single `typing.start` per burst and schedules a `typing.stop` after a
 * pause; `stop()` ends it immediately (on send / unmount). Never emits more than
 * one start per burst.
 */
export function useTypingSignal(friendId: string) {
  const { send } = useWebSocket()
  const typing = useRef(false)
  const idle = useRef<Timer>(undefined)

  const stop = useCallback(() => {
    if (idle.current) clearTimeout(idle.current)
    if (typing.current) {
      typing.current = false
      send({ type: 'typing.stop', toUserId: friendId })
    }
  }, [send, friendId])

  const onInput = useCallback(() => {
    if (!typing.current) {
      typing.current = true
      send({ type: 'typing.start', toUserId: friendId })
    }
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(stop, IDLE_MS)
  }, [send, friendId, stop])

  // Stop typing when leaving the conversation (and let the old friend know).
  useEffect(() => () => stop(), [stop])

  return { onInput, stop }
}

/**
 * Receiver side: whether the conversation partner is currently typing. Driven by
 * `typing.start` / `typing.stop` frames, with a fallback timeout so a lost stop
 * can't pin the indicator on.
 */
export function useTypingIndicator(friendId: string): boolean {
  const { subscribe } = useWebSocket()
  const [typing, setTyping] = useState(false)
  const fallback = useRef<Timer>(undefined)

  useEffect(() => {
    setTyping(false)
  }, [friendId])

  useEffect(() => {
    return subscribe((frame) => {
      if (frame.type === 'typing.start' && frame.data.userId === friendId) {
        setTyping(true)
        if (fallback.current) clearTimeout(fallback.current)
        fallback.current = setTimeout(() => setTyping(false), FALLBACK_MS)
      } else if (frame.type === 'typing.stop' && frame.data.userId === friendId) {
        if (fallback.current) clearTimeout(fallback.current)
        setTyping(false)
      }
    })
  }, [friendId, subscribe])

  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current)
    },
    [],
  )

  return typing
}
