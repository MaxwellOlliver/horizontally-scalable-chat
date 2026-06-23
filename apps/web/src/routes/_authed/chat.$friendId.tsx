import { createFileRoute } from '@tanstack/react-router'
import { Conversation } from '../../components/conversation/Conversation'

export const Route = createFileRoute('/_authed/chat/$friendId')({
  component: ChatRoute,
})

function ChatRoute() {
  const { friendId } = Route.useParams()
  // key forces a clean remount (and fresh message state) when switching threads.
  return <Conversation key={friendId} friendId={friendId} />
}
