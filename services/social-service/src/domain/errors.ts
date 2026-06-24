/**
 * Domain errors. Each carries a stable `code` the interface layer maps to an
 * HTTP status (interface/http/error-mapper.ts). Messages are safe to return.
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

/** AC-S2 — cannot friend yourself. */
export class SelfRequestError extends DomainError {
  readonly code = "SELF_REQUEST";
  constructor(message = "Cannot send a friend request to yourself") {
    super(message);
  }
}

/** AC-S3 — the two users are already friends. */
export class AlreadyFriendsError extends DomainError {
  readonly code = "ALREADY_FRIENDS";
  constructor(message = "Users are already friends") {
    super(message);
  }
}

/** AC-S4 — a pending request from requester to addressee already exists. */
export class DuplicateRequestError extends DomainError {
  readonly code = "DUPLICATE_REQUEST";
  constructor(message = "A pending request already exists") {
    super(message);
  }
}

/** AC-S6 — the addressee is not a known user. */
export class AddresseeNotFoundError extends DomainError {
  readonly code = "ADDRESSEE_NOT_FOUND";
  constructor(message = "Addressee does not exist") {
    super(message);
  }
}

/** Accept/reject targeting a request that does not exist. */
export class RequestNotFoundError extends DomainError {
  readonly code = "REQUEST_NOT_FOUND";
  constructor(message = "Friend request not found") {
    super(message);
  }
}

/** AC-R3 — only the addressee may respond. */
export class NotAddresseeError extends DomainError {
  readonly code = "NOT_ADDRESSEE";
  constructor(message = "Only the addressee may respond to this request") {
    super(message);
  }
}

/** AC-R4 — the request is no longer pending (already accepted/rejected). */
export class RequestNotPendingError extends DomainError {
  readonly code = "REQUEST_NOT_PENDING";
  constructor(message = "Friend request is not pending") {
    super(message);
  }
}

/** AC-U2 — un-friend when no friendship exists between the two users. */
export class FriendshipNotFoundError extends DomainError {
  readonly code = "FRIENDSHIP_NOT_FOUND";
  constructor(message = "No friendship exists between these users") {
    super(message);
  }
}
