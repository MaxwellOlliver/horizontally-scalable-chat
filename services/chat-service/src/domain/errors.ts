/**
 * Domain errors. Each carries a stable `code` the interface layer maps to an
 * outcome (HTTP status for history; a `message.rejected` frame for sends).
 * Messages are safe to surface to clients.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/** AC-M5 — empty (blank) message body. */
export class EmptyMessageError extends DomainError {
  readonly code = "EMPTY_MESSAGE";
  constructor(message = "Message body cannot be empty") {
    super(message);
  }
}

/** AC-M5 — body exceeds the max length. */
export class MessageTooLongError extends DomainError {
  readonly code = "MESSAGE_TOO_LONG";
  constructor(message = "Message body is too long") {
    super(message);
  }
}

/** AC-M2 — first message to a pair that are not active friends. */
export class NotFriendsError extends DomainError {
  readonly code = "NOT_FRIENDS";
  constructor(message = "You can only message confirmed friends") {
    super(message);
  }
}

/** AC-M2/G2 — send to a conversation closed by an un-friend. */
export class ConversationClosedError extends DomainError {
  readonly code = "CONVERSATION_CLOSED";
  constructor(message = "This conversation is closed") {
    super(message);
  }
}

/** AC-H3 — history requested for a conversation that does not exist. */
export class ConversationNotFoundError extends DomainError {
  readonly code = "CONVERSATION_NOT_FOUND";
  constructor(message = "Conversation not found") {
    super(message);
  }
}

/** AC-H3 — history requested by a non-participant. */
export class NotParticipantError extends DomainError {
  readonly code = "NOT_PARTICIPANT";
  constructor(message = "You are not a participant in this conversation") {
    super(message);
  }
}
