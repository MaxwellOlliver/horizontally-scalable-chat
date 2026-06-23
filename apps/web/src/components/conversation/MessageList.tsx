import { useEffect, useRef } from 'react'
import type { ConversationReceipts } from '../../features/conversation/useConversation'
import type { ChatMessage } from '../../features/conversation/messages'
import { MessageBubble } from './MessageBubble'

/** Scrollable thread, anchored to the bottom; auto-scrolls as messages arrive. */
export function MessageList({
  messages,
  receipts,
  loading,
}: {
  messages: ChatMessage[]
  receipts: ConversationReceipts
  loading: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-fg-faint border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
      {messages.length === 0 ? (
        <div className="m-auto text-center">
          <p className="text-[13px] text-fg-muted">No messages yet.</p>
          <p className="mt-1 text-[12.5px] text-fg-faint">Say hello to start the conversation.</p>
        </div>
      ) : (
        <div className="mt-auto flex flex-col gap-2">
          {messages.map((message) => (
            <MessageBubble key={message.key} message={message} receipts={receipts} />
          ))}
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
