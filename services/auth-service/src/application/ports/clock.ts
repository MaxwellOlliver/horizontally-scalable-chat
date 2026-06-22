/**
 * The Clock port is a platform-standard primitive shared across services.
 * Re-exported here so the application layer keeps referencing its own ports.
 */
export { type Clock, systemClock } from '@hsc/platform'
