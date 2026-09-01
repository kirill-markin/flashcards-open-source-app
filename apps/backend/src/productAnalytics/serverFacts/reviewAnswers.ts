import { transactionWithWorkspaceScopeDeadline, type DatabaseExecutor } from "../../database";
import { getDatabaseErrorFields } from "../../database/transient";
// Report through `observability/runtime`, never through `observability/sentry`. This is the shared
// discipline for product analytics producers, spelled out at length in contentCreations.ts:
// `entrypoints/directImageIngestion/lambda.test.ts` walks the direct image ingestion Lambda's
// runtime import graph and fails the build if it reaches an `observability/sentry/capture`, `config`
// or `tracing` module. That graph already holds ./serverEvents.ts, which the drain below calls, so a
// producer that reaches for the Sentry barrel leaves the build one new import away from breaking,
// and checking for a module cycle is not the same check. It costs the handlers that do initialize
// Sentry nothing: `initializeBackendSentry` installs `captureBackendWarning` as the runtime sink, so
// the warning below is the same Sentry warning there and the same structured CloudWatch record in
// the lean handler.
import {
  captureBackendRuntimeWarning,
  createBackendObservationScope,
} from "../../observability/runtime";
import type { ProductAnalyticsPlatform } from "../catalog";
import type { PostCommitAnalyticsBudget } from "./postCommitBudget";
import {
  deriveServerDerivedProductAnalyticsEventId,
  emitServerDerivedProductAnalyticsEvents,
  type ServerDerivedProductAnalyticsEvent,
} from "./serverEvents";
import { productAnalyticsMaxEventAgeMs } from "../validation";

// db/migrations/0001_initial_schema.sql declares content.review_events.rating as
// SMALLINT NOT NULL CHECK (rating BETWEEN 0 AND 3), and its column comment names the four values:
// 0 = again, 1 = hard, 2 = good, 3 = easy. The catalog takes the name rather than the integer,
// because a stored integer is unreadable in a query five months later. The index is always in range
// because the rating collected below is read back out of that column by the insert's RETURNING
// clause and never taken from a request body.
const reviewAnsweredRatingNames = ["again", "hard", "good", "easy"] as const;

/**
 * Where the reviewed_at_server stored with this review came from, named by the caller because only
 * the caller knows.
 *
 * content.review_events.reviewed_at_server is not a moment the backend observed on every path. The
 * direct review and the sync push stamp it with `new Date()` in the request that stores the row, so
 * those two are server clock readings. The review history import takes it from the request body
 * instead: `reviewEventImportPayloadSchema` (apps/backend/src/sync/contracts/input.ts) accepts any
 * RFC 3339 instant with no bound of any kind, reviewHistory.ts forwards it verbatim, the insert
 * stores it through COALESCE($8, now()), and RETURNING hands the client's own value straight back to
 * this producer.
 *
 * The value carries no evidence of its own origin, so this is a required argument rather than
 * something derived from it. Bounding one client timestamp against another bounds nothing: iOS
 * builds reviewed_at_client and reviewed_at_server from the same device clock, so a device whose
 * clock is wrong ships a self-consistent pair, and an entire imported history would be filed on an
 * arbitrary past day, permanently, on an append-only table. `client_supplied` therefore drops the
 * claimed value and anchors on a clock this invocation read itself.
 *
 * The guest merge is neither of those. It copies the column out of the guest workspace's own
 * content.review_events rows, and reading a value back out of our own table is not the same as the
 * backend having stamped it: the import route above accepts guest transport (it refuses only *web*
 * guests, apps/backend/src/routes/sync/guestPlatform.ts), and the iOS guest cloud bootstrap uses it
 * whenever local review events exist, so a guest workspace really can hold rows whose
 * reviewed_at_server is a device claim. `stored_unverified` names exactly that: legitimately old, and
 * therefore never pulled forward to merge day, but bounded above by a clock this invocation reads so
 * a claimed future instant cannot place a row on a day that has not happened.
 *
 * `server_stamped` stays for the two paths that did the stamping in the request at hand, where the
 * value is a reading by construction and needs no bound.
 */
export type ReviewAnsweredServerAnchor = "server_stamped" | "stored_unverified" | "client_supplied";

/**
 * One graded answer that a product transaction appended to content.review_events.
 *
 * Every field is read back from the inserted row rather than from the request that carried it, so
 * what is reported is what the workspace actually kept.
 */
export type ReviewAnswer = Readonly<{
  reviewEventId: string;
  workspaceId: string;
  // content.review_events.replica_id as stored, which is the one thing on the row that can name the
  // device the answer was given on. It is carried as the id rather than as a platform because the
  // replica row lives in another table: resolving it is one lookup for a whole drain instead of one
  // per answer on the review write. See resolveReviewAnswerPlatforms.
  replicaId: string;
  // security.current_user_id(), which is the identity every statement of the review write already
  // runs as.
  reviewedByUserId: string;
  // content.review_events.rating as stored, 0..3.
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
  serverAnchor: ReviewAnsweredServerAnchor;
}>;

// Answers observed inside one open transaction, keyed by the executor that is running it.
//
// Nothing is emitted while the transaction is open, for the two reasons the sibling producer gives.
// The analytics writer opens its own transaction on its own pool connection, so an inline emission
// would hold the review write's locks across one extra analytics transaction per graded answer on
// the product's hottest write path; and it could not be rolled back with the review, so a sync push,
// a review history import or a guest merge that failed at the k-th review - each of which applies
// its whole batch in one transaction - would have left permanent rows on an append-only table for
// reviews the workspace never kept.
//
// The buffer is created on first use and dropped when the executor is, so a transaction that throws
// leaves nothing behind.
const collectedReviewAnswers = new WeakMap<DatabaseExecutor, Array<ReviewAnswer>>();

/**
 * Records that this transaction appended one review event, to be reported once it commits.
 *
 * Called only from the branch of appendReviewEventSnapshotInExecutor where the
 * `ON CONFLICT DO NOTHING ... RETURNING` insert returned a row. That is the single replay gate this
 * producer has, and it adds none of its own. It covers the two paths differently. A retried sync
 * push re-sends the same review_event_id into the same workspace, so the row conflicts, no row is
 * returned and nothing reaches here at all. The guest merge does reach here for every review it
 * carries: mergeGuestWorkspaceIntoTargetInExecutor deletes the guest workspace's content before
 * re-inserting it into the target precisely so the global review_event_id is free again, so the
 * insert genuinely inserts and RETURNING hands back a row. What dedupes that path is the second
 * gate instead - the event id derived below from the review event id alone, which the guest's own
 * write already used, so the writer conflicts on event_id and stores nothing a second time.
 *
 * The answers only reach analytics through a transaction opened by
 * runTransactionReportingReviewAnswers. A transaction opened any other way collects them and drops
 * them with its executor, silently. Nothing warns about that, and nothing could: at this point the
 * drain has not run, and no state here can distinguish a transaction that will be drained from one
 * that will not, so there is no moment at which a warning would know it had something to report.
 * What makes the drop safe rather than merely quiet is that it is only ever a drop - the buffer dies
 * with the per-transaction executor and no wrong row can be written - and that the required
 * serverAnchor argument on appendReviewEventSnapshotInExecutor puts a compile-time stop in front of
 * any new caller, which is where a fifth review write path is caught.
 */
export function collectReviewAnswer(executor: DatabaseExecutor, answer: ReviewAnswer): void {
  const collected = collectedReviewAnswers.get(executor);
  if (collected === undefined) {
    collectedReviewAnswers.set(executor, [answer]);
    return;
  }

  collected.push(answer);
}

/**
 * The moment the backend observed this review, which is what the device clock is corrected against.
 *
 * A `client_supplied` anchor is discarded outright rather than clamped: the only bound a claimed
 * value can be given is a clock the backend read itself, and this drain's clock is exactly that.
 * A `server_stamped` anchor is used as stored, however old, because it already is such a reading.
 *
 * A `stored_unverified` anchor is used as stored too, but never past this drain's clock. That is a
 * ceiling and deliberately not a floor: the dangerous direction is a claimed instant in the future,
 * which would file a permanent row on a day that has not happened and corrupt "today" for every
 * chart reading this table, while an old value is what a guest who studied offline for months
 * actually has and flooring it would collapse that history onto merge day. What the ceiling does not
 * fix is a device clock that ran *behind*, which can still file a merged row earlier than it
 * happened. That is a property of the value the import route already stored, not something this
 * producer introduces, and repairing it belongs to a backfill that reads the rows offline.
 */
function resolveReviewAnsweredServerAnchor(answer: ReviewAnswer, recordedAt: Date): Date {
  if (answer.serverAnchor === "client_supplied") {
    return recordedAt;
  }

  const reviewedAtServerMs = new Date(answer.reviewedAtServer).getTime();
  if (Number.isNaN(reviewedAtServerMs)) {
    return recordedAt;
  }

  if (answer.serverAnchor === "stored_unverified" && reviewedAtServerMs > recordedAt.getTime()) {
    return recordedAt;
  }

  return new Date(reviewedAtServerMs);
}

/**
 * The moment the person answered, corrected for the device clock that reported it.
 *
 * content.review_events.reviewed_at_client carries no constraint of any kind and an offline-first
 * review can legitimately be days older than the sync that carried it, so the value is kept only
 * where it is plausible: within the same 30-day window the live client ingest accepts, and never
 * after the anchor. Outside it the anchor is used instead, which is the same rule the content
 * creations producer applies to client_updated_at.
 *
 * A value outside the window is dropped rather than pulled to the nearest edge, because an edge
 * value still claims a day the answer did not happen on.
 *
 * What this costs is worth naming: on the review history import the anchor is this drain's own
 * clock, so a genuinely old imported history collapses onto the day it was imported. That is the
 * price of an anchor no client can move, and reconstructing history for real belongs to a backfill,
 * which reads the same rows offline with no request clock to defend.
 */
function resolveReviewAnsweredOccurredAt(reviewedAtClient: string, serverAnchor: Date): Date {
  const reviewedAtClientMs = new Date(reviewedAtClient).getTime();
  if (Number.isNaN(reviewedAtClientMs)) {
    return serverAnchor;
  }

  if (reviewedAtClientMs > serverAnchor.getTime()) {
    return serverAnchor;
  }

  if (reviewedAtClientMs < serverAnchor.getTime() - productAnalyticsMaxEventAgeMs) {
    return serverAnchor;
  }

  return new Date(reviewedAtClientMs);
}

// The three columns the platform of one review is decided from, always read together. platform on
// its own decides nothing: sync.workspace_replicas constrains it to ios, android, web and system,
// and several actor kinds store a value in it that describes no device at all, so actor_kind is what
// makes the column readable and is selected on the same row rather than assumed.
type WorkspaceReplicaPlatformRow = Readonly<{
  replica_id: string;
  actor_kind: string;
  platform: string;
}>;

/**
 * The platform one replica answered on, or null where the replica names no device.
 *
 * Only a client_installation replica is a device a person used. The other actor kinds
 * (db/migrations/0035_sync_installations_and_workspace_replicas.sql) each store something in
 * platform that would be a lie here: an agent_connection replica stores 'web' for the machine API
 * that is no browser, an ai_chat replica stores a hardcoded 'web' that describes no device, and
 * workspace_seed and workspace_reset store 'system'. They resolve to null rather than to a fourth
 * value: `agent` exists in productAnalyticsPlatforms and could be derived from the actor kind, but
 * this event reports the device a person answered a card on, and deriving anything else from a
 * replica that is not a client installation is separate work with its own case to make.
 *
 * The remaining check is the one the column's own constraint leaves open: 'system' never reaches a
 * client_installation row, but reading platform as an analytics platform without confirming its
 * value is what would let a later widening of that constraint file reviews under something this
 * catalog never meant.
 */
function toReviewAnsweredPlatform(
  replica: WorkspaceReplicaPlatformRow,
): ProductAnalyticsPlatform | null {
  if (replica.actor_kind !== "client_installation") {
    return null;
  }

  if (replica.platform === "ios" || replica.platform === "android" || replica.platform === "web") {
    return replica.platform;
  }

  return null;
}

// The most one drain may spend resolving its replicas, including the product connection it checks
// out to do it.
//
// The read is a single primary-key lookup on a handful of ids, so nothing healthy approaches this;
// it is a ceiling for a degraded pool. It sits below the ~4s per-operation figure
// PostCommitAnalyticsBudget derives its tail from, so gating this read on the same budget as a chunk
// leaves the guaranteed tail exactly where ./postCommitBudget.ts states it, rather than adding the
// main pool's own 5s checkout timeout and an unbounded statement on top of it.
const reviewAnswerPlatformResolutionTimeoutMs = 2_000;

/**
 * Resolves the replicas of one drain to the platform each of their reviews was answered on.
 *
 * One query for the whole drain, after the product transaction committed. That is what makes the
 * derivation affordable at all: the answers were collected per transaction, so the review write
 * itself pays nothing for this, and a batch of any size - a sync push, a whole-history import, a
 * guest merge - resolves through the same single indexed lookup rather than one query per review.
 *
 * The read is scoped with the first answer's own identity and workspace, which is the scope the
 * review write ran under and the only one the RLS policy on sync.workspace_replicas admits
 * (workspace_replicas_scoped_select_runtime: the request-scoped workspace must match the row's and
 * the row's user_id must be the request's). Every path that reaches this producer writes its reviews
 * into one workspace as one identity, so that scope covers the whole drain; were that ever to stop
 * being true, the same policy would filter the answers that no longer belong to it and they would be
 * filed with a null platform rather than with another workspace's.
 *
 * Best effort, and it must be: the reviews are committed and this producer may not raise into a
 * caller whose transaction is already closed. A read that fails, a budget that is already spent, a
 * replica the scoped read does not reach - each leaves its answers out of the map, and out of a
 * per-platform breakdown, rather than guessing at a platform the append-only table could never be
 * corrected of.
 */
async function resolveReviewAnswerPlatforms(
  answers: ReadonlyArray<ReviewAnswer>,
  budget: PostCommitAnalyticsBudget,
): Promise<ReadonlyMap<string, ProductAnalyticsPlatform>> {
  const platformByReplicaId = new Map<string, ProductAnalyticsPlatform>();
  const scopingAnswer = answers[0];
  // The budget is checked here for the same reason a chunk checks it: this runs after COMMIT on the
  // request's own clock. A drain that finds it spent resolves nothing and the loop below then stops
  // on the same check, so the request pays for neither.
  if (scopingAnswer === undefined || !budget.hasTimeForAnotherOperation()) {
    return platformByReplicaId;
  }

  const replicaIds = [...new Set(answers.map((answer) => answer.replicaId))];
  const resolutionScope = createBackendObservationScope(
    "backend-api",
    null,
    null,
    null,
    scopingAnswer.reviewedByUserId,
    scopingAnswer.workspaceId,
    null,
    null,
    null,
    null,
    null,
  );
  try {
    const replicas = await transactionWithWorkspaceScopeDeadline(
      { userId: scopingAnswer.reviewedByUserId, workspaceId: scopingAnswer.workspaceId },
      Date.now() + reviewAnswerPlatformResolutionTimeoutMs,
      async (executor) => {
        const result = await executor.query<WorkspaceReplicaPlatformRow>(
          [
            "SELECT replica_id, actor_kind, platform",
            "FROM sync.workspace_replicas",
            "WHERE replica_id = ANY($1::uuid[])",
          ].join(" "),
          [replicaIds],
        );
        return result.rows;
      },
    );
    if (replicas.length < replicaIds.length) {
      // The read succeeded without matching every replica it asked about, so nothing throws and the
      // answers behind the missing rows go on to be stored with a null platform. replicaIds is
      // deduplicated and replica_id is the primary key of sync.workspace_replicas, so the read can
      // only come back short, never long, and the shortfall is exactly what is reported here.
      //
      // Guarded on the shortfall rather than on a zero-row read, because a partial one is the same
      // fault seen through fewer answers and is the harder of the two to notice: the reviews it
      // silences arrive mixed in with resolved ones, so the per-platform chart stays lit and only
      // undercounts. Nothing here makes it ordinary either. content.review_events.replica_id
      // references sync.workspace_replicas (db/migrations/0037_workspace_delete_schema_cleanup.sql),
      // so the row cannot have been deleted while the review naming it exists - what a missing row
      // means is that this scoped read no longer reaches it. The policy admits a row only where the
      // request's workspace scope reaches it and its user_id is the request's own
      // (workspace_replicas_scoped_select_runtime,
      // db/migrations/0035_sync_installations_and_workspace_replicas.sql), and that user_id is
      // rewritten to the registering identity every time a replica re-registers
      // (apps/backend/src/sync/identity/replica.ts), so one replica can drop out of a read the rest
      // of the drain sails through.
      //
      // The zero-row case is the same record with matchedReplicaCount at 0, not a second action: it
      // is this fault reaching every replica of the drain at once, and reading "0 of 4" and "3 of 4"
      // off one record is what makes the difference between them visible.
      captureBackendRuntimeWarning({
        action: "product_analytics_review_answered_platform_resolution_incomplete",
        scope: resolutionScope,
        details: {
          replicaIdCount: replicaIds.length,
          matchedReplicaCount: replicas.length,
          answerCount: answers.length,
        },
      });
    }
    for (const replica of replicas) {
      const platform = toReviewAnsweredPlatform(replica);
      if (platform !== null) {
        platformByReplicaId.set(replica.replica_id, platform);
      }
    }
  } catch (error) {
    // Reported rather than swallowed. The events themselves are unaffected and still worth storing,
    // so nothing here stops the drain - but a resolution that fails for every drain is otherwise
    // invisible, because the rows keep arriving and only the platform quietly stops being on them.
    const errorDetails = getDatabaseErrorFields(error);
    captureBackendRuntimeWarning({
      action: "product_analytics_review_answered_platform_resolution_failed",
      scope: resolutionScope,
      details: {
        replicaIdCount: replicaIds.length,
        answerCount: answers.length,
        sqlState: errorDetails.sqlState,
        errorClass: errorDetails.errorClass,
        errorMessage: errorDetails.errorMessage,
      },
    });
  }

  return platformByReplicaId;
}

function toReviewAnsweredEvent(
  answer: ReviewAnswer,
  recordedAt: Date,
  platform: ProductAnalyticsPlatform | null,
): ServerDerivedProductAnalyticsEvent {
  const serverAnchor = resolveReviewAnsweredServerAnchor(answer, recordedAt);
  return {
    // Keyed on the review event id alone. There is only ever one answer per review event, so every
    // path that can reach this producer again for the same one derives the same id and conflicts on
    // event_id in the writer instead of counting a second answer: a retried sync push re-sends the
    // same review_event_id, and the guest merge re-inserts the guest's row into the target workspace
    // under that same id.
    eventId: deriveServerDerivedProductAnalyticsEventId("review_answered", [answer.reviewEventId]),
    eventName: "review_answered",
    occurredAt: resolveReviewAnsweredOccurredAt(answer.reviewedAtClient, serverAnchor),
    // When the backend learned of the answer, kept apart from occurredAt so the device skew and the
    // offline interval stay recoverable as the difference between the two - which is the whole
    // reason a review answered offline is worth reporting at its own moment. For a guest merge this
    // is the reviewed_at_server the guest's workspace already carried, which is genuinely when the
    // backend received it and not the day the person signed in - except where that stored value
    // claimed a future instant, which the anchor above replaces with this drain's own clock.
    serverReceivedAt: serverAnchor,
    // The identity the review write ran as, resolved by that write and not looked up again here.
    //
    // It is written into both identity columns. For a guest that is exactly what a guest-transport
    // ingest request stores, and it is what lets a guest's reviews follow the account afterwards:
    // analytics.product_events_resolved reads the guest upgrade link through subject_user_id, so
    // without it every review answered before signing up would stay stranded on the guest identity.
    // For an account this names the authoritative user id where the ingest route would carry the
    // Cognito subject, which is a deliberate divergence shared with the content creations producer:
    // the only link keyed on subject_user_id is a guest upgrade, and no account's authoritative id
    // is ever a merged-away guest user id, so no attribution changes. A query that reads this column
    // as a Cognito subject, or that treats subject_user_id <> user_id as "this row came from a
    // mapped account", silently excludes every review_answered row.
    userId: answer.reviewedByUserId,
    subjectUserId: answer.reviewedByUserId,
    // The guest session behind the review is an auth-layer value no review write path sees. A
    // guest's rows stay identifiable as one actor through subject_user_id above, so what is lost
    // here is the guest/account split on the row itself, not the attribution.
    guestSessionId: null,
    workspaceId: answer.workspaceId,
    // The device the person answered on, derived from sync.workspace_replicas for the replica that
    // recorded the review and resolved once for the whole drain by resolveReviewAnswerPlatforms.
    //
    // This is the only server-stored platform the fact can reach, and the rule that governs it is
    // unchanged: the column may never be read without actor_kind on the same row. That is what the
    // resolution keeps rather than what it works around - it selects both columns on one row and
    // admits only a client_installation on ios, android or web, so the agent_connection replica
    // storing 'web' for the machine API, the ai_chat replica storing a hardcoded 'web' that
    // describes no device, and the workspace_seed and workspace_reset replicas storing 'system' all
    // arrive here as null exactly as they did when nothing was derived at all.
    //
    // What did change is the cost. One query per review on the product's hottest write path is
    // still not affordable, but that is what reading the replica inline would have cost, and this
    // producer does not emit inline: answers are collected per transaction and drained after COMMIT,
    // so a whole drain's platforms cost one indexed lookup that the review write never waits for.
    //
    // Null stays the answer for everything else - a replica the guard turns down, a replica the
    // scoped read did not reach, a resolution the drain could not make - because a guess would file
    // the review under a platform it never had, permanently, on an append-only table, while null
    // only leaves it out of a per-platform breakdown.
    platform,
    properties: { rating: reviewAnsweredRatingNames[answer.rating] },
    // Provenance about how a row was produced belongs to the backfill that reconstructs history. An
    // answer observed as it happens has none.
    details: null,
  };
}

// The most answers this producer hands the analytics writer in one statement.
//
// A drain is bounded by nothing a person chose: a review history import applies a batch bounded only
// by the request body, a guest merge re-inserts a guest workspace's whole review history, and every
// entry of both is an answer, while a sync push is bounded only by its operation list. Every batch
// the writer receives is a single unnest statement run under SET LOCAL statement_timeout = '2s' on a
// pool that refuses an acquisition after 2s, so one unbounded statement would put the biggest and
// most valuable drains - a whole-history guest merge, a full history import - behind the single
// timeout that loses all of them at once. Chunking bounds what one refusal can cost while keeping
// the per-row transaction cost that batching exists to avoid. The size matches the content creations
// producer because the writer, the statement and the timeout behind it are the same.
//
// Chunking is only safe together with both of the drain's stop rules. A chunk count is a multiplier
// on the analytics timeouts and it is paid after the product transaction committed, so a drain that
// continued through every chunk would let a degraded analytics pool time out the product request
// itself. Refusal is not the only way that happens: a chunk that is slow but still finishes inside
// the writer's statement timeout answers "stored", so the elapsed clock is the only stop that
// catches it. The drain therefore stops at the first refusal and again once the request's
// post-commit analytics clock is spent. See PostCommitAnalyticsBudget and
// emitCollectedReviewAnswers.
const reviewAnsweredEmitChunkSize = 500;

/**
 * Names the answers the drain gave up on, so an aborted drain is legible rather than silent.
 *
 * The reason says which of the two stop rules fired, because they call for opposite responses:
 * "writer_refused" means the analytics writer turned a chunk down and is degraded or down, while
 * "budget_exhausted" means every chunk it answered was stored and the request's post-commit
 * analytics clock ran out. That clock is shared with every other analytics stage of the request, so
 * a "budget_exhausted" stop here does not have to mean this drain was the large one: on a sync push
 * or a guest upgrade the content creations drain runs first and can spend it. Only "writer_refused"
 * has a paired product_analytics_server_event_write_failed carrying the error, and only it reports a
 * non-zero failedEventCount.
 *
 * The skip guard only ever fires for a refusal: a budget stop is decided before an unreached chunk,
 * so it always has something to name. A refusal of the last chunk abandoned nothing, and the write
 * failure that chunk already raised is the whole story, so a single review - which is what
 * submitReview always drains - still produces exactly one warning for one refusal.
 */
function reportAbandonedReviewAnswers(
  abandoned: Readonly<{
    reason: "writer_refused" | "budget_exhausted";
    reviewedByUserId: string | null;
    workspaceId: string | null;
    storedEventCount: number;
    failedEventCount: number;
    skippedEventCount: number;
  }>,
): void {
  if (abandoned.skippedEventCount <= 0) {
    return;
  }

  captureBackendRuntimeWarning({
    action: "product_analytics_review_answered_drain_aborted",
    scope: createBackendObservationScope(
      "backend-api",
      null,
      null,
      null,
      abandoned.reviewedByUserId,
      abandoned.workspaceId,
      null,
      null,
      null,
      null,
      null,
    ),
    details: {
      reason: abandoned.reason,
      storedEventCount: abandoned.storedEventCount,
      failedEventCount: abandoned.failedEventCount,
      skippedEventCount: abandoned.skippedEventCount,
    },
  });
}

/**
 * Reports the answers the committed transaction collected, in chunks of at most
 * reviewAnsweredEmitChunkSize, stopping at the first chunk the analytics writer refuses or once the
 * request's shared post-commit analytics budget is spent, whichever comes first.
 *
 * Awaited, and that cannot lengthen the review write: the transaction has committed and released its
 * locks before the first chunk is built. Nothing here is left running past the response instead,
 * because a Lambda container is frozen and killed unpredictably and anything buffered across that
 * would be lost silently, which is the invariant ../writer.ts states and every sibling producer keeps.
 *
 * A chunk is one analytics transaction on one analytics connection and the chunks are awaited in
 * sequence, so this producer holds one connection at a time however large the transaction was. The
 * platform resolution that runs before them is one short product-pool transaction, released before
 * the first chunk is built, so that stays true across both pools.
 *
 * Analytics is best effort and a review is not: a chunk is swallowed and logged by
 * emitServerDerivedProductAnalyticsEvents rather than raised, and the platform resolution is
 * swallowed and logged by resolveReviewAnswerPlatforms, so this function has no rejection path and
 * nothing here can surface as a failed review to a caller whose transaction already committed.
 * Neither stop discards the chunks already stored before it either - those are committed and stay
 * committed. What both give up is the rest of the drain, so that a degraded analytics pool cannot
 * push a request that already stored its reviews past the API Gateway integration timeout and answer
 * a 504 for work that succeeded.
 *
 * The budget is checked before each chunk and shared with every other gated post-commit analytics
 * stage of the request, so the gated tail is bounded at 4.0s of budget plus the one ~4.0s chunk
 * already in flight - 8.0s against the 29s integration timeout - however many stages the request
 * runs. That is what makes this drain's cost independent of the content-creations drain it follows
 * on the sync push and the guest upgrade, and of the completion event the guest upgrade goes on to
 * write. That upgrade also writes an analytics identity link that is deliberately exempt from the
 * budget, so its path alone carries 12.0s rather than 8.0s. The derivation, that exemption and what
 * each path used to pay are in ./postCommitBudget.ts.
 */
async function emitCollectedReviewAnswers(
  executor: DatabaseExecutor,
  budget: PostCommitAnalyticsBudget,
): Promise<void> {
  const collected = collectedReviewAnswers.get(executor);
  if (collected === undefined) {
    return;
  }

  collectedReviewAnswers.delete(executor);
  // The server clock every anchor of this drain is resolved against: it replaces a client_supplied
  // value outright and caps a stored_unverified one. The drain's stop clock is no longer read here:
  // it belongs to the request rather than to this drain, so it is the budget's.
  const recordedAt = new Date();
  // One read of the product database for the whole drain, before the first chunk and after the
  // commit that released this transaction's connection. Answers whose replica it does not resolve
  // keep the null platform they always had; nothing here can fail the drain.
  const platformByReplicaId = await resolveReviewAnswerPlatforms(collected, budget);
  for (let chunkStart = 0; chunkStart < collected.length; chunkStart += reviewAnsweredEmitChunkSize) {
    if (!budget.hasTimeForAnotherOperation()) {
      const firstSkipped = collected[chunkStart];
      reportAbandonedReviewAnswers({
        reason: "budget_exhausted",
        // The first answer this drain will not reach. Unlike a refusal there is no paired write
        // failure naming a row, so this is the only identity the stop reports.
        reviewedByUserId: firstSkipped?.reviewedByUserId ?? null,
        workspaceId: firstSkipped?.workspaceId ?? null,
        storedEventCount: chunkStart,
        // Every chunk the writer was handed was stored, so nothing failed - including when the
        // budget was spent by an earlier stage of the same request and this drain stored nothing at
        // all. The loop condition puts at least one answer behind this point, so the stop is never
        // dropped by the skip guard.
        failedEventCount: 0,
        skippedEventCount: collected.length - chunkStart,
      });
      return;
    }

    const chunk = collected.slice(chunkStart, chunkStart + reviewAnsweredEmitChunkSize);
    // Never rejects: the writer's refusal comes back as an outcome, so this await cannot throw into
    // a caller whose review transaction has already committed.
    const outcome = await emitServerDerivedProductAnalyticsEvents(
      chunk.map((answer) => toReviewAnsweredEvent(
        answer,
        recordedAt,
        platformByReplicaId.get(answer.replicaId) ?? null,
      )),
    );
    if (outcome === "stored") {
      continue;
    }

    const firstRefused = chunk[0];
    reportAbandonedReviewAnswers({
      reason: "writer_refused",
      // The refused chunk's first answer, which is the row its write failure named too.
      reviewedByUserId: firstRefused?.reviewedByUserId ?? null,
      workspaceId: firstRefused?.workspaceId ?? null,
      storedEventCount: chunkStart,
      failedEventCount: chunk.length,
      skippedEventCount: collected.length - chunkStart - chunk.length,
    });
    return;
  }
}

// The executor the transaction ran on, carried out alongside its result purely so the answers it
// collected can be drained afterwards. It is only ever used as the WeakMap key above: the pool client
// behind it is released once the transaction returns, and nothing here queries it. Exported only
// because it appears in the exported signature below; no caller has to name it.
export type CommittedReviewTransaction<Result> = Readonly<{
  executor: DatabaseExecutor;
  result: Result;
}>;

/**
 * Opens one product transaction through the caller's own opener and reports the review events it
 * appended.
 *
 * Every transaction that can reach appendReviewEventSnapshotInExecutor must be opened through this,
 * otherwise its answers are collected and then dropped. The opener is injected rather than chosen
 * here because the four review write paths do not share one: a direct review and a review history
 * import open a plain workspace-scoped transaction, a sync push opens the content creations wrapper,
 * and the guest upgrade opens the privileged one. Opening it here rather than trusting a callback to
 * have opened it is what makes the drain provably post-commit - the transaction returns only after
 * its COMMIT succeeded, so a transaction that threw never reaches the drain and its buffer is
 * dropped with its executor.
 *
 * Where the opener is a content creations wrapper, that wrapper's own drain runs inside
 * openTransaction and therefore strictly before this one, which makes its no-rejection guarantee
 * load-bearing here: a rejection from it would abandon this transaction's collected answers
 * unreported and surface to a caller whose transaction had already committed. The invariant is
 * stated on emitCollectedContentCreations, which is where it has to be kept.
 *
 * budget is the post-commit analytics clock the whole request shares, so that this drain, the
 * content creations drain nested inside openTransaction, and anything the caller reports after this
 * returns are bounded together rather than each on its own. It is required rather than optional
 * because two of the four review write paths already run other post-commit stages, and there are
 * only four call sites: making each one name the request's own clock is cheaper than leaving a
 * default that a fifth path could quietly inherit and re-break the bound with.
 */
export async function runTransactionReportingReviewAnswers<Result>(
  budget: PostCommitAnalyticsBudget,
  openTransaction: (
    body: (executor: DatabaseExecutor) => Promise<CommittedReviewTransaction<Result>>,
  ) => Promise<CommittedReviewTransaction<Result>>,
  body: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const committed = await openTransaction(async (executor) => ({
    executor,
    result: await body(executor),
  }));
  await emitCollectedReviewAnswers(committed.executor, budget);
  return committed.result;
}
