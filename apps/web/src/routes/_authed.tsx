import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { Sidebar } from '../components/chat/Sidebar'
import { Button } from '../components/ui/Button'
import { useAuth } from '../lib/auth/auth-context'
import { WebSocketProvider, useWebSocket } from '../lib/ws/WebSocketProvider'

/**
 * The authenticated shell: a fixed header over a persistent two-pane body
 * (sidebar + conversation area). `beforeLoad` is the route guard — unauthenticated
 * visitors are bounced to /login with the attempted URL preserved. The whole
 * shell lives inside the WebSocket provider so the header instrument, the offline
 * tip, and (next) the message view all share the one live connection.
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  return (
    <WebSocketProvider>
      <AuthedShell />
    </WebSocketProvider>
  )
}

function AuthedShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { linkState, latencyMs } = useWebSocket()
  const name = auth.user?.displayName ?? auth.user?.email ?? 'you'
  const degraded = linkState === 'reconnecting' || linkState === 'offline'

  async function onLogout() {
    await auth.logout()
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-6 py-3">
        <span className="text-gradient text-lg font-semibold tracking-[0.22em]">RELAY</span>
        <div className="flex items-center gap-3">
          <ConnectionStatus state={linkState} latencyMs={latencyMs} />
          <span className="hidden max-w-[16ch] truncate font-mono text-[11px] text-fg-muted sm:inline">
            {name}
          </span>
          <Button variant="ghost" onClick={onLogout} className="h-8 px-3 text-xs">
            Sign out
          </Button>
        </div>
      </header>

      {degraded && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/70 px-6 py-2 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-idle" />
          <span className="font-mono text-[11px] text-idle">
            {linkState === 'reconnecting'
              ? 'Connection lost — reconnecting…'
              : 'Offline — messages will sync when the link is back.'}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
