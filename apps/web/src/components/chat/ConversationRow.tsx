import { Link } from '@tanstack/react-router'
import type { ConversationListItem } from '../../lib/chat/types'
import { relativeTime } from '../../lib/format'
import { Avatar } from '../ui/Avatar'

/**
 * One conversation in the sidebar list — a link to the thread (addressed by the
 * other participant). The active thread is highlighted.
 */
export function ConversationRow({
  item,
  me,
  active = false,
}: {
  item: ConversationListItem
  me: string | undefined
  active?: boolean
}) {
  const name = item.otherUser.displayName ?? 'Unknown user'
  const last = item.lastMessage
  const preview = last ? `${last.senderId === me ? 'You: ' : ''}${last.body}` : 'No messages yet'
  // Hide the unread badge on the thread you're currently viewing.
  const unread = item.unreadCount > 0 && !active

  return (
    <Link
      to="/chat/$friendId"
      params={{ friendId: item.otherUser.id }}
      activeProps={{ className: 'bg-panel-dim' }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-panel-2/40"
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
          <span
            className={`min-w-0 flex-1 truncate text-[12.5px] ${
              unread ? 'font-medium text-fg' : last ? 'text-fg-muted' : 'italic text-fg-faint'
            }`}
          >
            {preview}
          </span>
          {unread && (
            <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-semibold text-ink">
              {item.unreadCount > 99 ? '99+' : item.unreadCount}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}
