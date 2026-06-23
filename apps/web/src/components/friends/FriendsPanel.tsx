import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import {
  useAcceptRequest,
  useAddFriend,
  useFriends,
  useIncomingRequests,
  useRejectRequest,
  useRemoveFriend,
} from '../../features/friends/hooks'
import type { Friend, PendingRequest } from '../../lib/social/types'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { EmptyState, ErrorState, ListSkeleton } from '../ui/ListStates'

/** The Friends tab: add by email, respond to incoming requests, and your friends. */
export function FriendsPanel() {
  return (
    <div className="flex flex-col gap-6 p-3">
      <AddFriend />
      <RequestsSection />
      <FriendsSection />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{children}</p>
  )
}

function AddFriend() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const add = useAddFriend()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setStatus(null)
    const value = email.trim()
    if (!value) return
    try {
      const result = await add.mutateAsync(value)
      setStatus({
        ok: true,
        msg: result.status === 'accepted' ? 'You’re now friends!' : 'Request sent.',
      })
      setEmail('')
    } catch (err) {
      setStatus({ ok: false, msg: addFriendError(err) })
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <SectionLabel>Add a friend</SectionLabel>
      <div className="flex gap-2 px-1">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@email.com"
          className="h-9 flex-1 rounded-lg border border-line bg-ink px-3 text-[13px] text-fg placeholder:text-fg-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <Button type="submit" loading={add.isPending} className="h-9 px-3 text-[13px]">
          Add
        </Button>
      </div>
      {status && (
        <p className={`px-1 text-[12px] ${status.ok ? 'text-live' : 'text-danger'}`}>{status.msg}</p>
      )}
    </form>
  )
}

function RequestsSection() {
  const { data } = useIncomingRequests()
  const accept = useAcceptRequest()
  const reject = useRejectRequest()

  if (!data || data.length === 0) return null

  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>Requests</SectionLabel>
      <ul className="flex flex-col gap-0.5">
        {data.map((request) => (
          <RequestRow
            key={request.requestId}
            request={request}
            onAccept={() => accept.mutate(request.requestId)}
            onReject={() => reject.mutate(request.requestId)}
            busy={accept.isPending || reject.isPending}
          />
        ))}
      </ul>
    </section>
  )
}

function RequestRow({
  request,
  onAccept,
  onReject,
  busy,
}: {
  request: PendingRequest
  onAccept: () => void
  onReject: () => void
  busy: boolean
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2">
      <Avatar name={request.otherUser.displayName} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
        {request.otherUser.displayName ?? 'Unknown user'}
      </span>
      <button
        type="button"
        onClick={onAccept}
        disabled={busy}
        className="rounded-lg bg-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent-strong transition-colors hover:bg-accent/25 disabled:opacity-50"
      >
        Accept
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={busy}
        aria-label="Reject request"
        className="rounded-lg px-2 py-1 text-[13px] text-fg-faint transition-colors hover:text-danger disabled:opacity-50"
      >
        ✕
      </button>
    </li>
  )
}

function FriendsSection() {
  const { data, isPending, isError, refetch } = useFriends()
  const remove = useRemoveFriend()

  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>Friends{data ? ` · ${data.length}` : ''}</SectionLabel>
      {isPending && <ListSkeleton rows={3} />}
      {isError && <ErrorState message="Couldn’t load friends" onRetry={() => refetch()} />}
      {data && data.length === 0 && (
        <EmptyState title="No friends yet" hint="Add someone by email above." />
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {data.map((friend) => (
            <FriendRow
              key={friend.friendshipId}
              friend={friend}
              onRemove={() => remove.mutate(friend.userId)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function FriendRow({ friend, onRemove }: { friend: Friend; onRemove: () => void }) {
  return (
    <li className="group flex items-center rounded-xl pr-2 transition-colors hover:bg-panel-2/60">
      <Link
        to="/chat/$friendId"
        params={{ friendId: friend.userId }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2"
      >
        <Avatar name={friend.displayName} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
          {friend.displayName ?? 'Unknown user'}
        </span>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${friend.displayName ?? 'friend'}`}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-fg-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
      >
        Remove
      </button>
    </li>
  )
}

function addFriendError(err: unknown): string {
  if (err instanceof AxiosError) {
    if (!err.response) return 'Can’t reach the server.'
    const code = (err.response.data as { error?: string } | undefined)?.error
    switch (code) {
      case 'ADDRESSEE_NOT_FOUND':
        return 'No user with that email.'
      case 'SELF_REQUEST':
        return 'You can’t add yourself.'
      case 'ALREADY_FRIENDS':
        return 'You’re already friends.'
      case 'DUPLICATE_REQUEST':
        return 'A request is already pending.'
      case 'VALIDATION_ERROR':
        return 'Enter a valid email.'
    }
  }
  return 'Something went wrong. Try again.'
}
