import { useState } from 'react'
import { useIncomingRequests } from '../../features/friends/hooks'
import { FriendsPanel } from '../friends/FriendsPanel'
import { ConversationList } from './ConversationList'

type Tab = 'chats' | 'friends'

/**
 * The left rail: a Chats / Friends tab switcher over the matching panel. The
 * Friends tab carries a badge with the incoming friend-request count (the inbox).
 */
export function Sidebar() {
  const [tab, setTab] = useState<Tab>('chats')
  const incoming = useIncomingRequests()
  const requestCount = incoming.data?.length ?? 0

  return (
    <aside className="flex w-80 shrink-0 flex-col bg-rail">
      <div className="flex shrink-0 gap-1 p-2">
        <TabButton active={tab === 'chats'} onClick={() => setTab('chats')}>
          Chats
        </TabButton>
        <TabButton
          active={tab === 'friends'}
          onClick={() => setTab('friends')}
          badge={requestCount}
        >
          Friends
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chats' ? <ConversationList /> : <FriendsPanel />}
      </div>
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  badge = 0,
  children,
}: {
  active: boolean
  onClick: () => void
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-panel-dim text-fg' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {children}
      {badge > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-ink">
          {badge}
        </span>
      )}
    </button>
  )
}
