import { useParams } from '@tanstack/react-router'
import { useConversations } from '../../features/conversations/useConversations'
import { useAuth } from '../../lib/auth/auth-context'
import { EmptyState, ErrorState, ListSkeleton } from '../ui/ListStates'
import { ConversationRow } from './ConversationRow'

/** The Chats tab: the user's conversations, most-recent-activity first. */
export function ConversationList() {
  const { user } = useAuth()
  const { data, isPending, isError, refetch } = useConversations()
  // The open thread (if any) — its unread badge is hidden, since you're reading it.
  const { friendId: openFriendId } = useParams({ strict: false })

  return (
    <div className="p-2">
      {isPending && <ListSkeleton />}
      {isError && <ErrorState message="Couldn’t load conversations" onRetry={() => refetch()} />}
      {data && data.length === 0 && (
        <EmptyState
          title="No conversations yet"
          hint="Add a friend and send the first message to start a thread."
        />
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {data.map((item) => (
            <li key={item.conversationId}>
              <ConversationRow
                item={item}
                me={user?.id}
                active={item.otherUser.id === openFriendId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
