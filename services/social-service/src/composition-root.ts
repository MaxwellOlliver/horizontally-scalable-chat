import type { Env } from "./config/env.js";
import type { Clock } from "./application/ports/clock.js";
import { systemClock } from "./application/ports/clock.js";
import type { AccessTokenVerifier } from "./application/ports/access-token-verifier.js";
import type { DomainEventPublisher } from "./application/ports/domain-event-publisher.js";
import type { FriendRequestRepository } from "./application/ports/friend-request-repository.js";
import type { FriendshipRepository } from "./application/ports/friendship-repository.js";
import type { IdGenerator } from "./application/ports/id-generator.js";
import type { LivePush } from "./application/ports/live-push.js";
import type { UserDirectory } from "./application/ports/user-directory.js";
import { AcceptFriendRequest } from "./application/use-cases/accept-friend-request.js";
import { AreFriends } from "./application/use-cases/are-friends.js";
import { ListFriends } from "./application/use-cases/list-friends.js";
import { ListPendingRequests } from "./application/use-cases/list-pending-requests.js";
import { RejectFriendRequest } from "./application/use-cases/reject-friend-request.js";
import { RemoveFriend } from "./application/use-cases/remove-friend.js";
import { SendFriendRequest } from "./application/use-cases/send-friend-request.js";
import { createDatabase, type Database } from "./infrastructure/db/client.js";
import { createDrizzleUserDirectory } from "./infrastructure/directory/drizzle-user-directory.js";
import { createRabbitMqDomainEventPublisher } from "./infrastructure/messaging/rabbitmq-domain-event-publisher.js";
import { createRedisLivePush } from "./infrastructure/realtime/redis-live-push.js";
import { createDrizzleFriendRequestRepository } from "./infrastructure/repositories/drizzle-friend-request-repository.js";
import { createDrizzleFriendshipRepository } from "./infrastructure/repositories/drizzle-friendship-repository.js";
import { createJwtAccessTokenVerifier, uuidv7Generator } from "@hsc/platform";
import type { SocialUseCases } from "./interface/http/routes/social.js";

/** Everything the use-case layer depends on, as ports (clean-arch boundary). */
export interface SocialPorts {
  friendRequests: FriendRequestRepository;
  friendships: FriendshipRepository;
  events: DomainEventPublisher;
  livePush: LivePush;
  users: UserDirectory;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Pure assembly of the use cases from ports. Production and tests both call this
 * — production passes Drizzle/RabbitMQ/Redis adapters, tests pass in-memory
 * fakes — so the wiring under test is the real wiring.
 */
export function assembleUseCases(ports: SocialPorts): SocialUseCases {
  const acceptDeps = {
    friendRequests: ports.friendRequests,
    friendships: ports.friendships,
    events: ports.events,
    livePush: ports.livePush,
    ids: ports.ids,
    clock: ports.clock,
  };
  return {
    sendFriendRequest: new SendFriendRequest({
      ...acceptDeps,
      users: ports.users,
    }),
    acceptFriendRequest: new AcceptFriendRequest(acceptDeps),
    rejectFriendRequest: new RejectFriendRequest(
      ports.friendRequests,
      ports.clock,
    ),
    removeFriend: new RemoveFriend(acceptDeps),
    areFriends: new AreFriends(ports.friendships),
    listFriends: new ListFriends(ports.friendships),
    listPendingRequests: new ListPendingRequests(ports.friendRequests),
  };
}

export interface Container {
  useCases: SocialUseCases;
  verifier: AccessTokenVerifier;
  db: Database;
  close(): Promise<void>;
}

/** Production container: real adapters wired from validated env. */
export function createContainer(env: Env): Container {
  const db = createDatabase(env.DATABASE_URL);
  const events = createRabbitMqDomainEventPublisher({
    url: env.RABBITMQ_URL,
    exchange: env.DOMAIN_EVENTS_EXCHANGE,
  });
  const livePush = createRedisLivePush(env.REDIS_URL);

  const useCases = assembleUseCases({
    friendRequests: createDrizzleFriendRequestRepository(db),
    friendships: createDrizzleFriendshipRepository(db),
    events,
    livePush,
    users: createDrizzleUserDirectory(db),
    ids: uuidv7Generator,
    clock: systemClock,
  });

  return {
    useCases,
    verifier: createJwtAccessTokenVerifier(env.JWT_SECRET, env.JWT_ISSUER),
    db,
    close: async () => {
      await Promise.allSettled([db.close(), events.close(), livePush.close()]);
    },
  };
}
