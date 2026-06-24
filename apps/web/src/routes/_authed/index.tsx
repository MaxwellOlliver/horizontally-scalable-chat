import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/')({
  component: NoConversation,
})

/**
 * The conversation area's default state — shown until a conversation is opened
 * (step 6 renders the message view here).
 */
function NoConversation() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-2">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.9A8.5 8.5 0 1 1 21 11.5Z" />
        </svg>
      </div>
      <h2 className="mt-4 text-lg font-medium tracking-tight text-fg">No conversation open</h2>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-fg-muted">
        Pick a friend from the sidebar to start chatting. Messages sync in real time across all your
        devices.
      </p>
    </div>
  )
}
