import type { productAnalyticsEventCatalog } from "../../productAnalytics/catalog";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
} from "../../productAnalytics/serverFacts/serverEvents";
import type { ChatRunActor } from "./types";

export type AiRunFailedReason =
  (typeof productAnalyticsEventCatalog)["ai_run_failed"]["properties"]["reason"]["values"][number];

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

/**
 * Reports one chat run that ended in failure, the counterpart of the turn reported above.
 *
 * Keyed on the same run the turn was keyed on, so a worker that finalizes a run a previous attempt
 * already finalized derives the same id again and the writer's `ON CONFLICT (event_id) DO NOTHING`
 * keeps one row per failed run however many attempts reach here.
 */
export async function recordAiRunFailedAnalytics(
  userId: string,
  workspaceId: string,
  runId: string,
  reason: AiRunFailedReason,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId("ai_run_failed", [workspaceId, runId]),
    eventName: "ai_run_failed",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId,
    // The worker holds the claimed run and not the request context the turn arrived in, so the
    // acting identity here is the workspace-scoped user the run was claimed for. A guest's own user
    // id is that same value, which is what the guest upgrade link resolves through, so a guest's
    // failed run still follows the account; what is lost is the guest session on the row itself.
    subjectUserId: userId,
    guestSessionId: null,
    workspaceId,
    // Null for the reason spelled out on the producer above: the only platform this path could read
    // is the one the client claimed in the request that started the run.
    platform: null,
    properties: { reason },
    details: null,
  });
}
