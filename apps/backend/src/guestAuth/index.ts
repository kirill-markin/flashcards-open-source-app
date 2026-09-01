import { runDatabaseOperationsWithDeadline } from "../database";
import { unsafeTransaction } from "../database/unsafe";
// Report through `observability/runtime`, never through `observability/sentry`, for the reason the
// product analytics producers spell out: `initializeBackendSentry` installs `captureBackendWarning`
// as the runtime sink, so this is the same Sentry warning wherever Sentry is initialized and the
// same structured CloudWatch record in a lean handler, without putting the Sentry barrel in this
// module's import graph.
import {
  captureBackendRuntimeWarning,
  createBackendObservationScope,
} from "../observability/runtime";
import { unsafeTransactionReportingContentCreations } from "../productAnalytics/serverFacts/contentCreations";
import {
  createPostCommitAnalyticsBudget,
  type PostCommitAnalyticsBudget,
} from "../productAnalytics/serverFacts/postCommitBudget";
import { runTransactionReportingReviewAnswers } from "../productAnalytics/serverFacts/reviewAnswers";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvent,
  linkServerDerivedProductAnalyticsIdentity,
} from "../productAnalytics/serverFacts/serverEvents";
import {
  deleteGuestSessionInExecutor,
} from "./delete/index";
import {
  linkGuestAnalyticsIdentityInExecutor,
} from "./identityLink/index";
import {
  authenticateGuestSession,
  bindGuestSessionPlatform,
  createGuestSessionInExecutor,
} from "./session/index";
import {
  completeGuestUpgradeInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./upgrade/index";
import type {
  GuestUpgradeCompleteCapabilities,
  GuestSessionPlatform,
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./types";

export type {
  GuestUpgradeCompleteCapabilities,
  GuestSessionPlatform,
  GuestSessionSnapshot,
  GuestUpgradeCompletion,
  GuestUpgradePreparation,
  GuestUpgradeSelection,
} from "./types";

export {
  authenticateGuestSession,
  bindGuestSessionPlatform,
  completeGuestUpgradeInExecutor,
  deleteGuestSessionInExecutor,
  linkGuestAnalyticsIdentityInExecutor,
  prepareGuestUpgradeInExecutor,
};

export async function createGuestSession(
  platform: GuestSessionPlatform | null,
  creationIdempotencyKey: string | null,
): Promise<GuestSessionSnapshot> {
  return unsafeTransaction(
    async (executor) => createGuestSessionInExecutor(executor, platform, creationIdempotencyKey),
  );
}

/**
 * Whole-transaction budget for the identity link, and the only bound this operation has.
 *
 * `runDatabaseOperationsWithDeadline` is what `database/deadline.ts` needs to bound this at all: it
 * derives a `statement_timeout` and `lock_timeout` from what is left of the budget before every
 * statement, and times the pool checkout from the same remainder rather than from the pool's own
 * equal `connectionTimeoutMillis`. Without it `unsafeTransaction` opens a plain `BEGIN` under no
 * timeout at all and the only stop is the 29s API Gateway integration timeout.
 *
 * The transaction is a short run of indexed single-row statements, so on a healthy database the
 * budget is spent waiting rather than running: it takes the Cognito identity lifecycle lock that
 * account deletion holds across its whole sweep, and locks the guest's `org.user_settings` and
 * `auth.guest_sessions` rows `FOR UPDATE`. A stop before the commit leaves nothing behind; one at
 * the commit answers `500 DATABASE_COMMIT_OUTCOME_UNKNOWN` instead. Neither is one attempt of several
 * for everyone: `apps/auth`'s sign-in producer drops the guest token with the visitor cookie on every
 * outcome, so a stop there loses that visitor's tail outright. Sized to stay inside the 10s the web
 * client allows one attempt, so that client sees a status code rather than its own abort.
 */
const guestIdentityLinkTransactionBudgetMs = 5_000;

export async function linkGuestAnalyticsIdentity(
  guestToken: string,
  cognitoSubject: string,
): Promise<void> {
  return runDatabaseOperationsWithDeadline(
    Date.now() + guestIdentityLinkTransactionBudgetMs,
    () => unsafeTransaction(
      async (executor) => linkGuestAnalyticsIdentityInExecutor(executor, guestToken, cognitoSubject),
    ),
  );
}

export async function prepareGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  email: string | null,
): Promise<GuestUpgradePreparation> {
  return unsafeTransaction(
    async (executor) => prepareGuestUpgradeInExecutor(executor, guestToken, cognitoSubject, email),
  );
}

/**
 * Records one completed guest upgrade for product analytics.
 *
 * Runs only after the upgrade transaction committed. The analytics writer commits on its own pool,
 * so emitting from inside the upgrade transaction would leave a permanent event and a permanent
 * identity link behind an upgrade that then rolled back. Neither can be taken back:
 * analytics.product_events is append-only, and analytics.product_events_resolved attributes a guest
 * to the earliest link on its id, so a link from an upgrade that never happened would silently
 * misattribute that guest's whole history if the guest later upgraded into a different account.
 * Keeping the writes out here also keeps the Cognito identity lifecycle lock and both users'
 * org.user_settings row locks from being held across the analytics connection acquisitions.
 *
 * Only a fresh completion is recorded: an idempotent replay returns an upgrade that already
 * happened. That gate is not enough on its own, because the same-user bound path never revokes the
 * guest session and returns a fresh completion again on every repeat of
 * POST /guest-auth/upgrade/complete, so a client retry after a timeout would report a second
 * conversion that never took place. The event id is therefore derived from the guest session id,
 * which is stable across retries on both the bound and the merge path, and the writer drops the
 * replay on the event_id conflict.
 *
 * Both writes are best effort, so a failing analytics database never fails an upgrade that is
 * already committed. On the merge path neither is ever retried, because the guest session is
 * revoked by the time this runs and any repeat of POST /guest-auth/upgrade/complete returns an
 * idempotent replay that never reaches this producer again. The identity link is therefore written
 * first. A lost event costs one row of a conversion metric, while a lost link leaves that guest's
 * whole pre-upgrade history resolving to the guest id instead of the account, so the link is the
 * write that should survive when only one of the two does. That path also records
 * auth.guest_upgrade_history, whose source_guest_user_id, target_user_id and source_guest_session_id
 * reconstruct either write afterwards; docs/analytics-db-access.md documents that route.
 *
 * A bound completion records no history row and writes no link, since the guest user id is already
 * the account id. Its repeat does reach this producer again, and the event id derived from the guest
 * session id is the only thing that keeps the conversion counted once.
 *
 * This is the last analytics stage of the upgrade, so it inherits whatever the two drains before it
 * left of the request's shared post-commit analytics budget. Only the completion event draws on that
 * budget; the identity link is exempt and always attempted. The budget is spent by chunked drains
 * that merely succeed slowly as readily as by ones that fail, and the review answers drain ahead of
 * this stage stores nothing at all for rows the guest had already synced, so a skippable link could
 * be starved by a drain that produced nothing - losing, permanently and unrepairably, the write the
 * paragraph above calls the one that should survive, to save one statement. Exempting it costs one
 * more single-statement write in the worst case: 4.0s of budget, plus the ~4.0s operation already in
 * flight when it ran out, plus this ~4.0s link is 12.0s of tail against the 29s integration timeout,
 * which the slowest write in the product still has room for. The event stays gated because losing it
 * costs one row of a conversion metric. On a healthy analytics pool the drains cost milliseconds and
 * the budget arrives untouched, so the stop only bites when analytics is degraded - where the write
 * it stops would most likely have been refused anyway.
 */
async function recordGuestUpgradeCompletedAnalytics(
  completion: GuestUpgradeCompletion,
  budget: PostCommitAnalyticsBudget,
): Promise<void> {
  // The bound path keeps the guest user id as the account id, so the guest's earlier events already
  // resolve to this account and a link would map the identity to itself.
  //
  // Deliberately not gated on the budget: see the exemption in the docstring above.
  if (completion.guestUserId !== completion.targetUserId) {
    // The client's own anonymous_id is not known here, so the link is keyed on the guest user id
    // that the guest's events carried as subject_user_id. analytics.product_events_resolved reads
    // that shape as well as the anonymous_id shape an authenticated ingest request writes, and a
    // guest-transport request writes the guest user id into user_id and subject_user_id alike, so
    // this one link resolves the guest's client events and the events the backend emitted for that
    // guest.
    await linkServerDerivedProductAnalyticsIdentity({
      anonymousId: completion.guestUserId,
      userId: completion.targetUserId,
    });
  }

  if (budget.hasTimeForAnotherOperation()) {
    // The upgrade is observed as it happens, so the two timestamps are one moment and there is no
    // skew to keep recoverable.
    const observedAt = new Date();
    await emitServerDerivedProductAnalyticsEvent({
      eventId: deriveServerDerivedProductAnalyticsEventId(
        "guest_upgrade_completed",
        [completion.guestSessionId],
      ),
      eventName: "guest_upgrade_completed",
      occurredAt: observedAt,
      serverReceivedAt: observedAt,
      userId: completion.targetUserId,
      // The guest identity the client's earlier events already carried, so the row names both sides
      // of the upgrade on its own.
      subjectUserId: completion.guestUserId,
      guestSessionId: completion.guestSessionId,
      workspaceId: completion.targetWorkspaceId,
      // auth.guest_sessions.platform would supply this from a server-stored source, but this path
      // does not read the session row and reporting the platform of upgrades is not what this change
      // is for; a producer that starts reading it may fill this in.
      platform: null,
      properties: {},
      details: null,
    });
    return;
  }

  // The completion event was never attempted, so it has no failure of its own to be read through and
  // the stop says so itself rather than staying silent. On the merge path it is never retried: the
  // guest session is revoked by the time this runs.
  captureBackendRuntimeWarning({
    action: "guest_upgrade_analytics_skipped",
    scope: createBackendObservationScope(
      "backend-api",
      null,
      null,
      null,
      completion.targetUserId,
      completion.targetWorkspaceId,
      null,
      null,
      completion.guestSessionId,
      null,
      null,
    ),
    details: { reason: "post_commit_budget_exhausted" },
  });
}

export async function completeGuestUpgrade(
  guestToken: string,
  cognitoSubject: string,
  selection: GuestUpgradeSelection,
  capabilities: GuestUpgradeCompleteCapabilities,
): Promise<GuestUpgradeCompletion> {
  // This request reports four analytics operations after its transaction commits - the content
  // creations drain, the review answers drain, and the two writes below - so they share one
  // post-commit analytics budget created here instead of each carrying a bound of its own, which
  // would sum. Three of the four are gated on it; the identity link is exempt, for the reason
  // recordGuestUpgradeCompletedAnalytics gives. That puts this path's tail at 12.0s against the 29s
  // integration timeout, and every other path's at 8.0s. See
  // ../productAnalytics/serverFacts/postCommitBudget.ts.
  const analyticsBudget = createPostCommitAnalyticsBudget();
  // The merge re-inserts the guest's review events into the target workspace under their original
  // review_event_id, so each collects a review_answered row that derives the id the guest's own
  // write already used and stores nothing a second time. They are emitted only once the merge has
  // committed, and a merge that fails emits nothing.
  //
  // That makes this drain mostly redundant once review_answered has been shipping for a while, and
  // there is deliberately no short-circuit for it. Every row the merge carries was loaded from
  // content.review_events for the guest workspace, so the backend had already stored it through
  // appendReviewEventSnapshotInExecutor and already collected an answer on the same derived id - a
  // review the guest took offline and never synced is not in that table and the merge never sees it
  // at all; it syncs later, into the target workspace, and is reported then. What is left is worth
  // the chunk it costs: rows written before this producer shipped, and rows whose original emission
  // was refused or skipped, for which the merge is the only second chance the append-only table
  // gets. Recognizing the redundant rows would mean asking analytics which event ids it already
  // holds, which is one more analytics round trip on the request with the least headroom - the same
  // cost as the chunk it would avoid - and it would still race the emission it is checking for.
  const completion = await runTransactionReportingReviewAnswers<GuestUpgradeCompletion>(
    analyticsBudget,
    (runInTransaction) => unsafeTransactionReportingContentCreations(
      runInTransaction,
      // The merge re-creates the guest's cards and decks inside the target workspace, under the
      // target scope, so the account that adopted them is the actor on those rows and not the guest
      // that wrote them offline. For a card the guest had already created through the sync API that
      // is invisible: the creation is keyed on the card id alone, so the merge's emission conflicts
      // with the guest's original row and the fact keeps the guest identity, which resolves to the
      // account through the upgrade link. It is only visible for a card that entered the guest
      // workspace without ever being reported as created - a catalog install - where the merge is
      // the first and only creation this stream ever sees for that card, and attributing it to the
      // account that kept it is the intended answer.
      (committed) => committed.result.targetUserId,
      analyticsBudget,
    ),
    async (executor) => completeGuestUpgradeInExecutor(
      executor,
      guestToken,
      cognitoSubject,
      selection,
      capabilities,
    ),
  );
  if (completion.outcome === "fresh_completion") {
    await recordGuestUpgradeCompletedAnalytics(completion, analyticsBudget);
  }

  return completion;
}

export async function deleteGuestSession(guestToken: string): Promise<void> {
  return unsafeTransaction(async (executor) => deleteGuestSessionInExecutor(executor, guestToken));
}
