import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
} from "../../productAnalytics/serverEvents";
import type { ChatRunActor } from "./types";

/**
 * Reports one user-sent chat turn to product analytics.
 *
 * Runs for every prepared run, deduplicated or not. A client that retries the same request replays
 * the run its first attempt stored, so the id derived from that run id is the same id again and the
 * writer's `ON CONFLICT (event_id) DO NOTHING` keeps exactly one row per turn however many times
 * this runs. Skipping the deduplicated prepare would leave that protection unreachable and turn a
 * dropped write — which this path swallows by design, and which a container killed between the
 * turn's COMMIT and this call produces just as well — into a permanent loss, because the retry
 * carrying the same clientRequestId is exactly the attempt that would otherwise still report it.
 */
export async function recordAiMessageSentAnalytics(
  userId: string,
  workspaceId: string,
  runId: string,
  actor: ChatRunActor,
): Promise<void> {
  // The turn is observed as it happens, so the two timestamps are one moment and there is no skew
  // to keep recoverable.
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId("ai_message_sent", [workspaceId, runId]),
    eventName: "ai_message_sent",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId,
    subjectUserId: actor.subjectUserId,
    guestSessionId: actor.guestSessionId,
    workspaceId,
    // The run carries no server-stored platform for the actor, and the request headers that do name
    // one are a client claim this row must not repeat.
    platform: null,
    properties: {},
    details: null,
  });
}
