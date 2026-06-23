export interface Friend {
  userId: string
  friendshipId: string
  since: string
  displayName: string | null
}

export interface PendingRequest {
  requestId: string
  requesterId: string
  addresseeId: string
  createdAt: string
  otherUser: { id: string; displayName: string | null }
}

export interface SendRequestResult {
  requestId: string
  /** `accepted` when it matched a reverse pending request (mutual intent). */
  status: 'pending' | 'accepted'
}

export type RequestDirection = 'incoming' | 'outgoing'
