import { useQuery } from '@tanstack/react-query'
import { listConversations } from '../../lib/chat/api'

/** The conversation list query. Socket events will invalidate `['conversations']`. */
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: listConversations,
  })
}
