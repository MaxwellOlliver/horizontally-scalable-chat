import { useConversation } from '../../features/conversation/useConversation'
import { usePresence } from '../../features/conversation/usePresence'
import { useTypingIndicator } from '../../features/conversation/useTyping'
import { Avatar } from '../ui/Avatar'
import { PresenceDot } from '../ui/PresenceDot'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { TypingIndicator } from './TypingIndicator'

/** A conversation thread, addressed by friend. Serves both an existing thread
 * and a brand-new one (created on the first send). */
export function Conversation({ friendId }: { friendId: string }) {
  const { friend, state, messages, receipts, sendMessage, isLoading, isError } =
    useConversation(friendId)
  const presence = usePresence(friendId)
  const friendTyping = useTypingIndicator(friendId)

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] text-fg-muted">This conversation couldn’t be opened.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <Avatar name={friend?.displayName ?? null} className="h-8 w-8 text-[10px]" />
        <div className="flex flex-col">
          <span className="text-[14px] font-medium leading-tight text-fg">
            {friend?.displayName ?? '…'}
          </span>
          <PresenceDot status={presence} withLabel />
        </div>
      </header>

      <MessageList messages={messages} receipts={receipts} loading={isLoading} />

      {state !== 'closed' && friendTyping && (
        <TypingIndicator name={friend?.displayName ?? 'They'} />
      )}

      {state === 'closed' ? (
        <div className="shrink-0 border-t border-line px-5 py-4 text-center">
          <p className="text-[12.5px] text-fg-muted">
            You’re no longer friends. Re-add them to start chatting again.
          </p>
        </div>
      ) : (
        <Composer friendId={friendId} onSend={sendMessage} />
      )}
    </div>
  )
}
