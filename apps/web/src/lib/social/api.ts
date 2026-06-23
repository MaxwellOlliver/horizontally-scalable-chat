import { api } from '../api'
import type { Friend, PendingRequest, RequestDirection, SendRequestResult } from './types'

export async function listFriends(): Promise<Friend[]> {
  const { data } = await api.get<Friend[]>('/social/friends')
  return data
}

export async function listRequests(direction: RequestDirection): Promise<PendingRequest[]> {
  const { data } = await api.get<PendingRequest[]>('/social/friends/requests', {
    params: { direction },
  })
  return data
}

/** Send a friend request, addressing the recipient by email (resolved server-side). */
export async function sendFriendRequest(email: string): Promise<SendRequestResult> {
  const { data } = await api.post<SendRequestResult>('/social/friends/requests', { email })
  return data
}

export async function acceptRequest(requestId: string): Promise<void> {
  await api.post(`/social/friends/requests/${requestId}/accept`)
}

export async function rejectRequest(requestId: string): Promise<void> {
  await api.post(`/social/friends/requests/${requestId}/reject`)
}

export async function removeFriend(userId: string): Promise<void> {
  await api.delete(`/social/friends/${userId}`)
}
