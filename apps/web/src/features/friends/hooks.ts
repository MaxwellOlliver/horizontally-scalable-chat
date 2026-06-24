import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as social from '../../lib/social/api'

export function useFriends() {
  return useQuery({ queryKey: ['friends'], queryFn: social.listFriends })
}

export function useIncomingRequests() {
  return useQuery({ queryKey: ['requests', 'incoming'], queryFn: () => social.listRequests('incoming') })
}

export function useOutgoingRequests() {
  return useQuery({ queryKey: ['requests', 'outgoing'], queryFn: () => social.listRequests('outgoing') })
}

/** Send a friend request by email (one POST; the server resolves the user). */
export function useAddFriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => social.sendFriendRequest(email),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['requests', 'outgoing'] })
      // A reverse-pending request means we became friends immediately (AC-S5).
      if (result.status === 'accepted') {
        qc.invalidateQueries({ queryKey: ['friends'] })
        qc.invalidateQueries({ queryKey: ['conversations'] })
        // Re-resolve any open thread so a re-friended conversation reopens.
        qc.invalidateQueries({ queryKey: ['conversation'] })
      }
    },
  })
}

export function useAcceptRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) => social.acceptRequest(requestId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['requests', 'incoming'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      // Re-resolve any open thread so a re-friended conversation reopens.
      qc.invalidateQueries({ queryKey: ['conversation'] })
    },
  })
}

export function useRejectRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) => social.rejectRequest(requestId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests', 'incoming'] }),
  })
}

export function useRemoveFriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => social.removeFriend(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      // Re-resolve any open thread so it flips to `closed` and hides the composer.
      qc.invalidateQueries({ queryKey: ['conversation'] })
    },
  })
}
