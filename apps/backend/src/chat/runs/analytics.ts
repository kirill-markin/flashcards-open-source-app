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
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId("ai_message_sent", [workspaceId, runId]),
    eventName: "ai_message_sent",
    occurredAt: new Date(),
    userId,
    subjectUserId: actor.subjectUserId,
    guestSessionId: actor.guestSessionId,
    workspaceId,
    properties: {},
  });
}
