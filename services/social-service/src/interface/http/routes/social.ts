import { Elysia } from "elysia";
import type { LogEmitter } from "@hsc/platform";
import type { AccessTokenVerifier } from "../../../application/ports/access-token-verifier.js";
import type { AcceptFriendRequest } from "../../../application/use-cases/accept-friend-request.js";
import type { AreFriends } from "../../../application/use-cases/are-friends.js";
import type { ListFriends } from "../../../application/use-cases/list-friends.js";
import type { ListPendingRequests } from "../../../application/use-cases/list-pending-requests.js";
import type { RejectFriendRequest } from "../../../application/use-cases/reject-friend-request.js";
import type { RemoveFriend } from "../../../application/use-cases/remove-friend.js";
import type { SendFriendRequest } from "../../../application/use-cases/send-friend-request.js";
import { requireUser } from "../auth-context.js";
import { toHttpError } from "../error-mapper.js";
import {
  directionSchema,
  requestIdSchema,
  sendRequestSchema,
  userIdSchema,
} from "../validation.js";

export interface SocialUseCases {
  sendFriendRequest: SendFriendRequest;
  acceptFriendRequest: AcceptFriendRequest;
  rejectFriendRequest: RejectFriendRequest;
  removeFriend: RemoveFriend;
  areFriends: AreFriends;
  listFriends: ListFriends;
  listPendingRequests: ListPendingRequests;
}

export interface SocialRoutesDeps {
  useCases: SocialUseCases;
  verifier: AccessTokenVerifier;
  logger: LogEmitter;
}

/**
 * Elysia plugin for `/social/friends/*` (spec §2.6). The `/social` segment is
 * the service prefix (mirrors `/auth/*` -> auth-service), `/friends` the
 * resource. Every handler authenticates the caller (Bearer token), runs the use
 * case, and maps domain/validation/auth errors to the documented status.
 */
export function createSocialRoutes({ useCases, verifier, logger }: SocialRoutesDeps) {
  return new Elysia({ prefix: "/social/friends" })
    .post("/requests", async ({ body, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        const { email } = sendRequestSchema.parse(body);
        const result = await useCases.sendFriendRequest.execute(me, email);
        if (result.status === "accepted") {
          // Mutual intent: the addressee had already requested us, so this
          // request immediately formed a friendship — both sides see that.
          logger.emit(me, "Friend request accepted");
          logger.emit(result.addresseeId, "Friend request accepted");
        } else {
          logger.emit(me, "Friend request sent");
          logger.emit(result.addresseeId, "Friend request received");
        }
        set.status = 201;
        return result;
      } catch (err) {
        return fail(set, err);
      }
    })
    .post("/requests/:id/accept", async ({ params, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        const id = requestIdSchema.parse(params.id);
        const result = await useCases.acceptFriendRequest.execute(id, me);
        logger.emit(me, "Friend request accepted");
        // Notify the original requester that we accepted (the user's reported gap).
        logger.emit(result.requesterId, "Friend request accepted");
        set.status = 200;
        return result;
      } catch (err) {
        return fail(set, err);
      }
    })
    .post("/requests/:id/reject", async ({ params, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        const id = requestIdSchema.parse(params.id);
        await useCases.rejectFriendRequest.execute(id, me);
        logger.emit(me, "Friend request rejected");
        set.status = 204;
        return null;
      } catch (err) {
        return fail(set, err);
      }
    })
    .delete("/:userId", async ({ params, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        const userId = userIdSchema.parse(params.userId);
        await useCases.removeFriend.execute(me, userId);
        logger.emit(me, "Friend removed");
        logger.emit(userId, "Friend removed"); // the dropped friend sees it too
        set.status = 204;
        return null;
      } catch (err) {
        return fail(set, err);
      }
    })
    .get("/", async ({ headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        set.status = 200;
        return await useCases.listFriends.execute(me);
      } catch (err) {
        return fail(set, err);
      }
    })
    .get("/requests", async ({ headers, query, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        const direction = directionSchema.parse(query.direction);
        set.status = 200;
        return await useCases.listPendingRequests.execute(me, direction);
      } catch (err) {
        return fail(set, err);
      }
    })
    .get("/:otherUserId/status", async ({ params, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier);
        const otherUserId = requestIdSchema.parse(params.otherUserId);
        set.status = 200;
        return {
          areFriends: await useCases.areFriends.execute(me, otherUserId),
        };
      } catch (err) {
        return fail(set, err);
      }
    });
}

function fail(set: { status?: number | string }, err: unknown) {
  const { status, body } = toHttpError(err);
  set.status = status;
  return body;
}
