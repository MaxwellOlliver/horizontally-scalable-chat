import type { DomainEvent } from "../domain/events.js";
import type { DomainEventPublisher } from "./ports/domain-event-publisher.js";
import type { LiveFrame, LivePush } from "./ports/live-push.js";

/**
 * Best-effort outbound. The state change is already durably committed before
 * these run (AC-E4); a broker/Redis hiccup must not fail the user's request or
 * undo the commit. The lists remain the source of truth (AC-P4); the bus
 * upgrade to a transactional outbox is noted out of scope for v1 (§2.4a).
 */
export async function safePublish(
  publisher: DomainEventPublisher,
  event: DomainEvent,
): Promise<void> {
  try {
    await publisher.publish(event);
  } catch (err) {
    console.error(`[social] event publish failed: ${event.type}`, err);
  }
}

export async function safePush(
  push: LivePush,
  userId: string,
  frame: LiveFrame,
): Promise<void> {
  try {
    await push.pushToUser(userId, frame);
    console.log("[social] live push succeed");
  } catch (err) {
    console.error(`[social] live push failed: ${frame.type}`, err);
  }
}
