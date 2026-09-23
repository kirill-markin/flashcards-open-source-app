import { randomUUID } from "node:crypto";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
} from "./serverEvents";

// The decisions a person takes about their own account, workspace and data, each reported by the
// backend that carried it out and by nothing else. They share a shape - one fact per committed
// decision, observed as it happens, with no replica behind it to read a platform from - so they
// share a file rather than one module each.
//
// None of them reads a platform. Every one arrives on a request whose only platform claim is a
// header, which a server-derived row must never repeat, and none of them writes through a
// sync.workspace_replicas row the way the content and review producers do. The one exception
// available is the guest session's own platform column on the feedback route, and it is refused
// below for a reason stated there.
//
// Every producer here emits after its product transaction committed, so a row can only ever report
// something the database kept. account_deleted is the single exception and says why at its own call
// site.

/**
 * Reports the anonymization of one person's whole history as the deletion it is.
 *
 * Called from inside the deletion transaction, immediately before the sweep that rewrites every row
 * of this person to one pseudonym: the analytics writer holds its own connection and commits at
 * once, so the row is already stored when the sweep runs and is anonymized with the rest. A row
 * written after the transaction instead would be the only one left carrying the ids the deletion
 * exists to remove. What that costs is a transaction that rolls back after this point leaving one
 * row claiming a deletion that did not happen; the exchange is deliberate, because the alternative
 * is an un-anonymizable identity on an append-only table.
 *
 * It is countable by row count and never by distinct actor: each deletion mints its own pseudonym
 * and stores it nowhere, so the deleted person's rows share an id that belongs to no one.
 *
 * The event id is random rather than derived, which no other producer here does. A derived id is a
 * reproducible function of its inputs and this repository is public, so an id derived from the user
 * id being erased would let anyone holding that id find this row and read the pseudonym off it -
 * handing back the link to the anonymized history that the deletion just removed. Minting one is
 * safe here because the deletion cannot be replayed: a second attempt finds the subject's tombstone
 * and returns before reaching any of this.
 */
export async function recordAccountDeletedAnalytics(userId: string): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: randomUUID(),
    eventName: "account_deleted",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    // Both identity columns carry the id the sweep matches on, so this row is anonymized exactly
    // like every other row of this person rather than by a column list that happens to include it.
    userId,
    subjectUserId: userId,
    guestSessionId: null,
    // The sweep clears workspace_id on every row it rewrites, so naming one here would only be
    // cleared a statement later.
    workspaceId: null,
    platform: null,
    properties: {},
    details: null,
  });
}

/**
 * Reports one workspace the person deleted, after the transaction that dropped it committed.
 *
 * Only the human workspace-delete route reaches this. A workspace destroyed as part of an account
 * deletion reports nothing here, because that decision is `account_deleted` and counting it twice
 * would make every account deletion look like a workspace deletion as well.
 */
export async function recordWorkspaceDeletedAnalytics(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    // One workspace can only be deleted once, so its own id is a key no retry can duplicate.
    eventId: deriveServerDerivedProductAnalyticsEventId("workspace_deleted", [workspaceId]),
    eventName: "workspace_deleted",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId,
    // The route refuses guest and api_key transport, so there is no second identity behind this
    // fact that user_id does not already name.
    subjectUserId: null,
    guestSessionId: null,
    // The org.workspaces row is gone by now, so this names a workspace that no longer exists.
    workspaceId,
    platform: null,
    properties: {},
    details: null,
  });
}

/**
 * Reports one workspace whose scheduling state the person put back to new.
 *
 * Called only when the reset actually changed cards: a confirmed reset of a workspace with nothing
 * scheduled writes nothing, so this counts resets rather than confirmations.
 *
 * A workspace can be reset any number of times and the reset writes no row of its own to key on, so
 * the id is derived from the workspace and the instant the backend observed it. Two resets of one
 * workspace in the same millisecond would collapse into one row; nothing else can collide, because
 * a repeat that finds nothing left to reset never reaches this.
 */
export async function recordStudyProgressResetAnalytics(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "study_progress_reset",
      [workspaceId, observedAt.toISOString()],
    ),
    eventName: "study_progress_reset",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId,
    subjectUserId: null,
    guestSessionId: null,
    workspaceId,
    platform: null,
    properties: {},
    details: null,
  });
}

export type WorkspacePackageImportedFact = Readonly<{
  userId: string;
  // auth.guest_sessions identifies a guest on this route, which admits guest transport unlike the
  // workspace management routes above.
  subjectUserId: string;
  guestSessionId: string | null;
  workspaceId: string;
  // The client's own id for this import, which the import options carry.
  importId: string;
  // Cards the import persisted, not cards the package offered.
  cardCount: number;
}>;

/**
 * Reports one workspace package the person imported, after its cards were committed.
 *
 * The import also produces one `card_created` per card carrying source `package_import`, and
 * `card_count` here is what the persistence returned, so the two are readable against each other
 * except in the one case the key cannot cover.
 *
 * The import id is the client's, and this counts distinct import ids rather than imports, because
 * the import is not idempotent on it: persistWorkspacePackageImportCardsWithDependencies mints
 * fresh card ids on every call, so a client that retries one id writes a second full library of
 * cards and stores no second row here. Enforcing the id is a product change and would be what makes
 * this count imports.
 */
export async function recordWorkspacePackageImportedAnalytics(
  fact: WorkspacePackageImportedFact,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "workspace_package_imported",
      [fact.workspaceId, fact.importId],
    ),
    eventName: "workspace_package_imported",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId: fact.userId,
    subjectUserId: fact.subjectUserId,
    guestSessionId: fact.guestSessionId,
    workspaceId: fact.workspaceId,
    platform: null,
    properties: {
      card_count: fact.cardCount,
    },
    details: null,
  });
}

export type WorkspacePackageExportedFact = Readonly<{
  userId: string;
  subjectUserId: string;
  guestSessionId: string | null;
  workspaceId: string;
}>;

/**
 * Reports one workspace package the person exported, after the bytes were built.
 *
 * An export writes nothing, so there is no row, no client-supplied id to key on and no server state
 * that makes a repeat a no-op; the id is derived from the workspace and the instant instead. What
 * that counts is export requests that produced bytes rather than export decisions: a deliberate
 * second export and a transport retry of one whose response never arrived are alike a second row,
 * and only two exports of one workspace inside the same millisecond would collapse.
 */
export async function recordWorkspacePackageExportedAnalytics(
  fact: WorkspacePackageExportedFact,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "workspace_package_exported",
      [fact.workspaceId, observedAt.toISOString()],
    ),
    eventName: "workspace_package_exported",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId: fact.userId,
    subjectUserId: fact.subjectUserId,
    guestSessionId: fact.guestSessionId,
    workspaceId: fact.workspaceId,
    platform: null,
    properties: {},
    details: null,
  });
}

/**
 * Reports one agent connection the person created, after its API key row committed.
 *
 * The connection id is minted by the backend for that row, so it keys the event exactly. Revoking a
 * connection reports nothing, and a key created and never used is still counted here: what this
 * counts is the moment the terminal / AI-agent client became usable, not its traffic.
 */
export async function recordAgentConnectionCreatedAnalytics(
  userId: string,
  connectionId: string,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "agent_connection_created",
      [connectionId],
    ),
    eventName: "agent_connection_created",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId,
    // The route refuses guest and api_key transport: a connection is always created from a signed-in
    // human session.
    subjectUserId: null,
    guestSessionId: null,
    // auth.agent_api_keys is account-scoped and names no workspace.
    workspaceId: null,
    // `agent` belongs to the facts this connection goes on to produce, not to its creation, which
    // happens in whatever client the person was signed in to.
    platform: null,
    properties: {},
    details: null,
  });
}

export type FeedbackSubmittedFact = Readonly<{
  userId: string;
  subjectUserId: string;
  guestSessionId: string | null;
  // support.feedback_submissions.workspace_id as the store read it back, never the request body's:
  // only the request that inserted the row had its workspace id checked against this person's
  // memberships. It is null for a submission sent from outside a workspace.
  workspaceId: string | null;
  // The client's idempotency key for the submission, and the primary key of the stored row.
  feedbackSubmissionId: string;
}>;

/**
 * Reports one feedback message that reached support.feedback_submissions.
 *
 * The prompt events the same surface records are deliberately not reported: this counts the message
 * a person chose to send. The submission is idempotent on its id, so a client resending one reaches
 * this again and conflicts on the derived event id instead of counting a second message.
 *
 * No platform, although the route does admit guest transport and auth.guest_sessions.platform would
 * be safe to read. Only a guest has that row, so reading it would produce a per-platform breakdown
 * covering guests alone and silently missing every signed-in submission, which is worse than the
 * null that leaves all of them out together.
 */
export async function recordFeedbackSubmittedAnalytics(
  fact: FeedbackSubmittedFact,
): Promise<void> {
  const observedAt = new Date();
  await emitServerDerivedProductAnalyticsEvent({
    eventId: deriveServerDerivedProductAnalyticsEventId(
      "feedback_submitted",
      [fact.feedbackSubmissionId],
    ),
    eventName: "feedback_submitted",
    occurredAt: observedAt,
    serverReceivedAt: observedAt,
    userId: fact.userId,
    subjectUserId: fact.subjectUserId,
    guestSessionId: fact.guestSessionId,
    workspaceId: fact.workspaceId,
    platform: null,
    properties: {},
    details: null,
  });
}
