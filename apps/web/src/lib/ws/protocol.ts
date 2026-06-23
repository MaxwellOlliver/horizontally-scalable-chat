/** The live state of the gateway socket, surfaced by the ConnectionStatus instrument. */
export type LinkState = 'connecting' | 'live' | 'reconnecting' | 'offline'

/** A friend's effective presence (REQUIREMENTS §5). */
export type PresenceStatus = 'online' | 'idle' | 'offline'

/** Frames the client sends to the gateway (auth §2.4, messaging §2.2, presence §5). */
export type ClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'ping' }
  | { type: 'focus' }
  | { type: 'blur' }
  | { type: 'message.send'; clientMsgId: string; toUserId: string; body: string }
  | { type: 'presence.subscribe'; userIds: string[] }
  | { type: 'typing.start'; toUserId: string }
  | { type: 'typing.stop'; toUserId: string }
  | { type: 'receipt'; conversationId: string; deliveredUpTo?: string; readUpTo?: string }

export interface MessageReceivedFrame {
  type: 'message.received'
  data: {
    id: string
    conversationId: string
    senderId: string
    recipientId: string
    clientMsgId: string
    body: string
    createdAt: string
  }
}

export interface MessageSentFrame {
  type: 'message.sent'
  data: { clientMsgId: string; id: string; conversationId: string; createdAt: string }
}

export interface MessageRejectedFrame {
  type: 'message.rejected'
  data: { clientMsgId: string; reason: string; message: string }
}

export interface FriendRequestReceivedFrame {
  type: 'friend_request.received'
  data: { requestId: string; requesterId: string }
}

export interface FriendRequestAcceptedFrame {
  type: 'friend_request.accepted'
  data: { friendshipId: string; by: string }
}

export interface FriendshipRemovedFrame {
  type: 'friendship.removed'
  data: { userId: string; by: string }
}

export interface PresenceChangedFrame {
  type: 'presence.changed'
  data: { userId: string; status: PresenceStatus }
}

/** Ephemeral typing signal from the conversation partner (REQUIREMENTS §6). */
export interface TypingFrame {
  type: 'typing.start' | 'typing.stop'
  data: { userId: string }
}

/** The partner's advanced delivered/read high-water marks (REQUIREMENTS §4). */
export interface ReceiptUpdateFrame {
  type: 'receipt.update'
  data: {
    conversationId: string
    by: string
    deliveredUpTo: string | null
    readUpTo: string | null
  }
}

/**
 * Frames the gateway/services send to the client — a discriminated union on
 * `type`. Unknown/unhandled frames simply don't match any case in the dispatcher
 * and are ignored (the runtime parse is untyped JSON cast to this).
 */
export type ServerFrame =
  | { type: 'auth_ok' }
  | { type: 'pong' }
  | MessageReceivedFrame
  | MessageSentFrame
  | MessageRejectedFrame
  | FriendRequestReceivedFrame
  | FriendRequestAcceptedFrame
  | FriendshipRemovedFrame
  | PresenceChangedFrame
  | TypingFrame
  | ReceiptUpdateFrame
