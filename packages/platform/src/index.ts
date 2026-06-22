/**
 * @hsc/platform — shared infrastructure primitives reused across services
 * (auth-service, social-service, chat-service). Generic adapters live here;
 * each service binds them to its own schema/domain types in a thin wrapper.
 */
export { type Clock, systemClock } from './clock.js'
export { type IdGenerator, uuidv7Generator } from './id-generator.js'
export { createDatabase } from './db.js'
export {
  type AccessTokenVerifier,
  type AuthenticatedUser,
  createJwtAccessTokenVerifier,
} from './jwt.js'
export { type RedisPublisher, createRedisPublisher, userChannel } from './redis.js'
export {
  type RabbitMqTopicConfig,
  type TopicPublishOptions,
  type TopicPublisher,
  createRabbitMqTopicPublisher,
  type RabbitMqDelivery,
  type RabbitMqHandler,
  type RabbitMqConsumer,
  type RabbitMqWorkQueueConfig,
  type RabbitMqTopicConsumerConfig,
  createRabbitMqWorkQueueConsumer,
  createRabbitMqTopicConsumer,
} from './rabbitmq.js'
