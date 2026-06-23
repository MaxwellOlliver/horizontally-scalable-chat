import { Link } from '@tanstack/react-router'
import type { ConversationListItem } from '../../lib/chat/types'
import { relativeTime } from '../../lib/format'
import { Avatar } from '../ui/Avatar'

/**
 * One conversation in the sidebar list — a link to the thread (addressed by the
 * other participant). The active thread is highlighted.
 */
export function ConversationRow({ item, me }: { item: ConversationListItem; me: string | undefined }) {
  const name = item.otherUser.displayName ?? 'Unknown user'
  const last = item.lastMessage
  const preview = last ? `${last.senderId === me ? 'You: ' : ''}${last.body}` : 'No messages yet'

  return (
    <Link
      to="/chat/$friendId"
      params={{ friendId: item.otherUser.id }}
      activeProps={{ className: 'bg-panel-2' }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-panel-2/70"
    >
      <Avatar name={item.otherUser.displayName} className="h-10 w-10 text-xs" />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{name}</span>
          {last && (
            <span className="shrink-0 font-mono text-[10px] text-fg-faint">
              {relativeTime(last.createdAt)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {item.state === 'closed' && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg-faint">closed</span>
          )}
          <span className={`truncate text-[12.5px] ${last ? 'text-fg-muted' : 'italic text-fg-faint'}`}>
            {preview}
          </span>
        </span>
      </span>
    </Link>
  )
}
