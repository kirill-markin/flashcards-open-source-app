import type pg from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  runDatabaseOperationsWithDeadline,
  DatabaseDeadlineExceededError,
  type DatabaseExecutor,
  type SqlValue,
} from "../../database";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
} from "../../database/transient";
import { unsafeTransaction } from "../../database/unsafe";
import { withReportingReadOnlyTransaction } from "../../admin/reportingDb";
import {
  captureBackendWarning,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../../observability/sentry";
import { toIsoString } from "../shared";
import {
  deleteGuestWorkspaceIfOwnedBySoleMemberInExecutor,
  deleteUserSettingsInExecutor,
  loadGuestWorkspaceIdOrNullInExecutor,
} from "../store/index";

/**
 * Permanent removal of web guest identities that never became an account and stopped being seen.
 *
 * A web guest is an analytics credential a signed-out browser mints on its first interaction. It is
 * refused on every authenticated surface except analytics ingest, so its auto-created workspace is
 * empty by construction and the four rows it owns only accumulate. `ios` and `android` guests own a
 * real offline workspace and can be upgraded into an account, so they are deliberately never
 * candidates here, and neither is the `NULL` platform that pre-1.7.0 mobile clients still write.
 *
 * `auth.guest_sessions.last_seen_at` is not a liveness signal: no code path ever updates it and it
 * always equals `created_at`. Liveness is the newest server clock reading on the guest's
 * `analytics.product_events` rows, falling back to when its newest session was created if it
 * produced no events at all.
 */

const webGuestInactivityThresholdDays = 90;

const minimumBatchSize = 1;
const maximumBatchSize = 2_000;
const minimumMaxPages = 1;
const maximumMaxPages = 100;
const serverDerivedIdentityLinkSource = "server_derived";
// auth.guest_sessions.user_id is TEXT while analytics.product_events.user_id and
// analytics.identity_links.anonymous_id are UUID. A guest id that is not a UUID can match no
// analytics row at all, so it resolves to NULL instead of failing the whole batch on a cast error.
const guestUserIdUuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
// Microsecond precision with an explicit UTC offset, which is what a timestamptz actually stores
// and what makes the keyset walk exact when the value is sent back as the cursor.
const cursorTimestampFormat = 'YYYY-MM-DD"T"HH24:MI:SS.USOF';
// The workspace_seed replica is written by workspace bootstrap itself, in the same transaction as
// org.workspaces, so it is present in every workspace and is never a sign of guest activity.
const bootstrapWorkspaceReplicaActorKind = "workspace_seed";
// The two SQLSTATEs a guest that ran out of its own budget surfaces as. `database/deadline.ts`
// configures both server-side timeouts before every statement: a `statement_timeout` of the guest
// transaction's remaining budget minus a 250ms rollback reserve, and a `lock_timeout` one
// millisecond under it. `57014` (query_canceled) is what a guest that spends that budget *running*
// a statement raises, shortly before the JavaScript-side deadline could fire. `55P03`
// (lock_not_available) is what a guest that spends it *waiting* for a lock raises a millisecond
// earlier: the `FOR UPDATE` in loadGuestWorkspaceIdOrNullInExecutor, or the `pg_advisory_xact_lock`
// deleteGuestWorkspaceIfOwnedBySoleMemberInExecutor takes. Both mean the same thing here - the
// server stopped this guest because its budget was gone, the transaction is aborted and rolled
// back, and nothing was deleted - so both are the run running out of time, not a guest that failed.
const guestBudgetExhaustedSqlStates: ReadonlySet<string> = new Set(["57014", "55P03"]);

type WebGuestReaperCursor = Readonly<{
  latestSessionCreatedAt: string;
  guestUserId: string;
}> | null;

type WebGuestReaperCandidate = Readonly<{
  guestUserId: string;
  analyticsUserId: string | null;
  latestSessionCreatedAt: string;
  lastActiveAt: string;
}>;

type WebGuestReaperSkipReason =
  | "workspace_has_content"
  | "workspace_not_sole_owned"
  | "workspace_missing"
  | "no_longer_a_candidate";

type WebGuestReaperCandidateOutcome =
  | Readonly<{ outcome: "deleted"; workspaceId: string }>
  | Readonly<{ outcome: "skipped"; workspaceId: string | null; reason: WebGuestReaperSkipReason }>;

export type WebGuestReaperRequest = Readonly<{
  batchSize: number;
  maxPages: number;
  deadlineAtMs: number;
}>;

export type WebGuestReaperResult = Readonly<{
  inactivityThresholdDays: number;
  inactiveBefore: string;
  pagesScanned: number;
  candidatesExamined: number;
  deleted: number;
  skipped: number;
  skippedWorkspaceHasContent: number;
  skippedWorkspaceNotSoleOwned: number;
  skippedWorkspaceMissing: number;
  skippedNoLongerCandidate: number;
  interrupted: number;
  failed: number;
  // The run stopped on a candidate scan that threw. Everything the run already deleted is counted
  // in the fields above, and the entrypoint still turns this flag into a thrown error.
  scanFailed: boolean;
  finished: boolean;
}>;

type WebGuestReaperCandidateRow = Readonly<{
  guest_user_id: string;
  analytics_user_id: string | null;
  latest_session_created_at: string;
  last_active_at: Date | string;
}>;

type GuestWorkspaceContentPresenceRow = Readonly<{
  has_content: boolean;
}>;

type WebGuestStillReapableRow = Readonly<{
  still_reapable: boolean;
}>;

type ReportingQueryExecutor = Readonly<{
  query<Row extends pg.QueryResultRow>(
    text: string,
    params: ReadonlyArray<SqlValue>,
  ): Promise<pg.QueryResult<Row>>;
}>;

// Each guest is reaped in its own transaction with its own deadline, so a guest that has to be
// skipped or that fails cannot roll back the rest of the batch and cannot stall the run either.
// A guest transaction is started only when this whole budget is still available: starting one with
// whatever is left makes the deadline fire mid-transaction, which is a run that ran out of time
// rather than a guest that failed.
const guestDeadlineMs = 15_000;
// The candidate scan is bounded only by the reporting role's own 30s statement_timeout (migration
// 0044), so a page is started only when that much of the run budget is still left. Without the
// reserve, a scan begun just before the deadline runs past the entrypoint's finalization reserve
// and hard-times-out the Lambda, which loses the whole web_guest_reaper_completed record. The
// reserve covers the whole scan only because a scan is attempted exactly once; see loadCandidates.
const candidateScanBudgetMs = 30_000;

function requireIntegerInRange(
  value: number,
  fieldName: string,
  minimumValue: number,
  maximumValue: number,
): number {
  if (!Number.isInteger(value) || value < minimumValue || value > maximumValue) {
    throw new Error(`${fieldName} must be an integer between ${minimumValue} and ${maximumValue}`);
  }

  return value;
}

function calculateWebGuestInactiveBefore(nowMs: number): Date {
  return new Date(nowMs - webGuestInactivityThresholdDays * 24 * 60 * 60 * 1_000);
}

function mapCandidateRow(row: WebGuestReaperCandidateRow): WebGuestReaperCandidate {
  return {
    guestUserId: row.guest_user_id,
    analyticsUserId: row.analytics_user_id,
    // Kept exactly as PostgreSQL rendered it, microseconds included: it is fed straight back as the
    // keyset cursor and a JS Date would floor it to milliseconds first. See the query below.
    latestSessionCreatedAt: row.latest_session_created_at,
    lastActiveAt: toIsoString(row.last_active_at),
  };
}

function createCursorFromCandidate(candidate: WebGuestReaperCandidate): WebGuestReaperCursor {
  return {
    latestSessionCreatedAt: candidate.latestSessionCreatedAt,
    guestUserId: candidate.guestUserId,
  };
}

/**
 * Reads across every guest, so it runs as the read-only reporting role: row level security scopes
 * the runtime role's own view of `org` and `content` to one user at a time. The reporting role
 * carries a 30s `statement_timeout` of its own (migration `0044`), which is what bounds this scan.
 *
 * The page is a keyset walk over `(latest_session_created_at, guest_user_id)` rather than a bare
 * `LIMIT`: a guest that is skipped for good, such as one whose workspace turned out to hold
 * content, would otherwise sit at the head of the ordering and consume a slot of every future run.
 *
 * `rowLimit` is the SQL `LIMIT`, not the page size: the caller asks for one row past the page it
 * intends to process so that a full page can be told apart from a page that exhausted the
 * candidates.
 */
async function loadWebGuestReaperCandidatesInExecutor(
  executor: ReportingQueryExecutor,
  inactiveBefore: Date,
  rowLimit: number,
  cursor: WebGuestReaperCursor,
): Promise<ReadonlyArray<WebGuestReaperCandidate>> {
  const result = await executor.query<WebGuestReaperCandidateRow>(
    [
      "WITH stale_web_guest_sessions AS (",
      "SELECT",
      "guest_sessions.user_id AS guest_user_id,",
      "MAX(guest_sessions.created_at) AS latest_session_created_at",
      "FROM auth.guest_sessions AS guest_sessions",
      // Mobile guests are out of scope by product decision, not by oversight: ios and android
      // guests own a syncable workspace and an upgrade path, and NULL is what pre-1.7.0 mobile
      // clients still write, so neither may ever reach the deletion loop below.
      "WHERE guest_sessions.platform = 'web'",
      "AND guest_sessions.created_at < $1::timestamptz",
      "GROUP BY guest_sessions.user_id",
      "),",
      "stale_web_guests AS (",
      "SELECT",
      "sessions.guest_user_id,",
      "sessions.latest_session_created_at,",
      "CASE",
      `WHEN sessions.guest_user_id ~ '${guestUserIdUuidPattern}'`,
      "THEN sessions.guest_user_id::uuid",
      "END AS analytics_user_id",
      "FROM stale_web_guest_sessions AS sessions",
      // Deleting org.user_settings cascades every session the guest owns, so a guest that also
      // holds a mobile session, or a web session newer than the threshold, is not a candidate.
      "WHERE NOT EXISTS (",
      "SELECT 1",
      "FROM auth.guest_sessions AS other_sessions",
      "WHERE other_sessions.user_id = sessions.guest_user_id",
      "AND (",
      "other_sessions.platform IS DISTINCT FROM 'web'",
      "OR other_sessions.created_at >= $1::timestamptz",
      ")",
      ")",
      ")",
      "SELECT",
      "guests.guest_user_id,",
      "guests.analytics_user_id,",
      // Rendered as text with microseconds and an explicit offset rather than returned as a
      // timestamptz: the value comes straight back as the keyset cursor below, and a driver-mapped
      // JS Date would floor it to milliseconds, which moves the cursor slightly backwards and lets
      // the boundary guest of a page be returned again on the next one.
      `to_char(guests.latest_session_created_at, '${cursorTimestampFormat}') AS latest_session_created_at,`,
      "COALESCE(latest_event.last_seen_at, guests.latest_session_created_at) AS last_active_at",
      "FROM stale_web_guests AS guests",
      // One indexed lookup per candidate through idx_product_events_user_id (migration 0115), so
      // the event table is never scanned. The driving aggregate above now has
      // idx_guest_sessions_platform_created (migration 0118) instead of the whole-table read it
      // used to need - available rather than guaranteed, since the planner still prefers a
      // sequential scan while the table is small enough for that to be cheaper, and keeps the index
      // only while created_at below the inactivity threshold stays selective.
      "LEFT JOIN LATERAL (",
      // occurred_at is the skew-corrected client clock and can sit up to 30 days before the server
      // ever saw the batch, so it alone would let a guest look older than it is. ingested_at is the
      // documented server-clock checkpoint, and the later of the two is "when the server last saw
      // anything from this guest", which is what the 90 days is meant to measure.
      "SELECT GREATEST(MAX(events.occurred_at), MAX(events.ingested_at)) AS last_seen_at",
      "FROM analytics.product_events AS events",
      "WHERE events.user_id = guests.analytics_user_id",
      ") AS latest_event ON TRUE",
      // A server-derived identity link is the only record that this guest became an account, so its
      // absence is what "never signed in" means.
      "WHERE NOT EXISTS (",
      "SELECT 1",
      "FROM analytics.identity_links AS identity_links",
      "WHERE identity_links.anonymous_id = guests.analytics_user_id",
      "AND identity_links.source = $2",
      ")",
      "AND COALESCE(latest_event.last_seen_at, guests.latest_session_created_at) < $1::timestamptz",
      "AND (",
      "$4::timestamptz IS NULL",
      "OR (guests.latest_session_created_at, guests.guest_user_id) > ($4::timestamptz, $5::text)",
      ")",
      "ORDER BY guests.latest_session_created_at ASC, guests.guest_user_id ASC",
      "LIMIT $3",
    ].join(" "),
    [
      inactiveBefore,
      serverDerivedIdentityLinkSource,
      rowLimit,
      cursor?.latestSessionCreatedAt ?? null,
      cursor?.guestUserId ?? null,
    ],
  );

  return result.rows.map(mapCandidateRow);
}

/**
 * Re-asserts the candidate rule inside the deletion transaction.
 *
 * Candidates are selected once per page as the reporting role and then deleted one at a time, so a
 * guest that produced an event, signed in, or opened a new session between its selection and its
 * own turn would otherwise be deleted on stale evidence, and the deletion is permanent. The runtime
 * role reads both analytics tables under `USING (true)` policies (migration `0114`) and
 * `auth.guest_sessions` has no row level security, so the whole rule is available here, and
 * `idx_product_events_user_id` plus `idx_guest_sessions_user_created` serve both lookups.
 *
 * This narrows the window, it does not close it. The `FOR UPDATE` the caller already holds on
 * `org.user_settings` pins nothing read here: analytics ingest inserts into
 * `analytics.product_events` without touching that row, and the transaction is READ COMMITTED, so a
 * guest that becomes active between this re-check and the delete below is still deleted. The
 * residual window is the few milliseconds those statements take, and reaching it needs a guest that
 * was dormant for 90 days to come back inside exactly that window, so it is accepted rather than
 * locked against.
 */
async function webGuestIsStillReapableInExecutor(
  executor: DatabaseExecutor,
  candidate: WebGuestReaperCandidate,
  inactiveBefore: Date,
): Promise<boolean> {
  const result = await executor.query<WebGuestStillReapableRow>(
    [
      "SELECT (",
      "NOT EXISTS (",
      "SELECT 1",
      "FROM analytics.identity_links AS identity_links",
      "WHERE identity_links.anonymous_id = $2::uuid",
      "AND identity_links.source = $3",
      ")",
      "AND NOT EXISTS (",
      "SELECT 1",
      "FROM analytics.product_events AS events",
      "WHERE events.user_id = $2::uuid",
      "AND GREATEST(events.occurred_at, events.ingested_at) >= $4::timestamptz",
      ")",
      "AND NOT EXISTS (",
      "SELECT 1",
      "FROM auth.guest_sessions AS guest_sessions",
      "WHERE guest_sessions.user_id = $1",
      "AND (",
      "guest_sessions.platform IS DISTINCT FROM 'web'",
      "OR guest_sessions.created_at >= $4::timestamptz",
      ")",
      ")",
      ") AS still_reapable",
    ].join(" "),
    [
      candidate.guestUserId,
      candidate.analyticsUserId,
      serverDerivedIdentityLinkSource,
      inactiveBefore,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Web guest liveness re-check returned no row for guest ${candidate.guestUserId}`);
  }

  return row.still_reapable;
}

/**
 * Deleting `org.workspaces` cascades far past the four content tables a card lives in, so the probe
 * covers every cascading child a pristine guest workspace has no row in. Three cascading children
 * are deliberately absent: `org.workspace_memberships`, `sync.workspace_sync_metadata` and
 * `sync.hot_changes` are written by workspace bootstrap itself, so a row in them proves nothing.
 * `sync.workspace_replicas` is bootstrapped too, which is why only a non-seed actor counts; every
 * sync push, AI chat and upload claim mints one of those first, so it also stands in for
 * `content.media_upload_session_creation_claims`. That table must not be added here as a
 * belt-and-braces check: migration `0100` ends with
 * `REVOKE ALL ON TABLE content.media_upload_session_creation_claims FROM PUBLIC, backend_app,
 * auth_app, reporting_readonly` and no later migration grants it back, so `backend_app` holds no
 * privilege on it at all and a direct probe raises `permission denied` for every candidate rather
 * than reading empty, which would mark every guest failed and stop all deletion.
 */
async function guestWorkspaceHasContentInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<boolean> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });
  const result = await executor.query<GuestWorkspaceContentPresenceRow>(
    [
      "SELECT (",
      "EXISTS (SELECT 1 FROM content.cards WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM content.decks WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM content.review_events WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM content.media_assets WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM content.media_upload_sessions WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM content.generated_media_promotion_jobs WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM ai.chat_sessions WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM sync.applied_operations_current WHERE workspace_id = $1::uuid)",
      "OR EXISTS (SELECT 1 FROM sync.catalog_package_install_idempotency WHERE workspace_id = $1::uuid)",
      "OR EXISTS (",
      "SELECT 1 FROM sync.workspace_replicas",
      "WHERE workspace_id = $1::uuid AND actor_kind <> $2",
      ")",
      ") AS has_content",
    ].join(" "),
    [guestWorkspaceId, bootstrapWorkspaceReplicaActorKind],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Guest workspace content probe returned no row for workspace ${guestWorkspaceId}`);
  }

  return row.has_content;
}

async function reapWebGuestInExecutor(
  executor: DatabaseExecutor,
  candidate: WebGuestReaperCandidate,
  inactiveBefore: Date,
): Promise<WebGuestReaperCandidateOutcome> {
  // org.user_settings.workspace_id is ON DELETE SET NULL from org.workspaces (migration 0001), so a
  // guest with no selected workspace is reachable. It has nothing this job can delete safely, and
  // treating it as a failure would make one such row fail the run every night forever.
  const guestWorkspaceId = await loadGuestWorkspaceIdOrNullInExecutor(executor, candidate.guestUserId);
  if (guestWorkspaceId === null) {
    return { outcome: "skipped", workspaceId: null, reason: "workspace_missing" };
  }

  const stillReapable = await webGuestIsStillReapableInExecutor(executor, candidate, inactiveBefore);
  if (!stillReapable) {
    return { outcome: "skipped", workspaceId: guestWorkspaceId, reason: "no_longer_a_candidate" };
  }

  // A web guest workspace is empty by construction. Content here means an invariant broke
  // elsewhere, and that has to stay visible rather than be deleted along with the guest.
  if (await guestWorkspaceHasContentInExecutor(executor, candidate.guestUserId, guestWorkspaceId)) {
    return { outcome: "skipped", workspaceId: guestWorkspaceId, reason: "workspace_has_content" };
  }

  const deletedWorkspace = await deleteGuestWorkspaceIfOwnedBySoleMemberInExecutor(
    executor,
    candidate.guestUserId,
    guestWorkspaceId,
  );
  if (!deletedWorkspace) {
    return { outcome: "skipped", workspaceId: guestWorkspaceId, reason: "workspace_not_sole_owned" };
  }

  // Cascades org.workspace_memberships, auth.guest_sessions and auth.guest_ai_monthly_usage. The
  // analytics schema holds no foreign key into org, so the guest's events and identity links
  // survive untouched, which is deliberate.
  //
  // This cascade is wider than the workspace probe above: org.user_settings is also the parent of
  // auth.user_identities, support.feedback_prompt_events and support.feedback_submissions, the
  // community public profile, friend invitation and friendship tables, auth.agent_api_keys,
  // auth.oauth_connections and progress.user_active_review_days, plus the two ON DELETE SET NULL
  // children migration 0058 added, content.review_events.reviewed_by_user_id and
  // community.public_review_activity_facts.reviewed_by_user_id. None of them is probed, and none
  // needs one, because a row in any of them belongs either to a user that authored a review event
  // or to a user that was admitted on an authenticated surface other than analytics ingest, and a
  // web guest can obtain neither.
  //
  // Do not shorten that to "written only from an authenticated HTTP surface": these tables also
  // have non-HTTP writers, and both of them stand on review authorship rather than on a request.
  // progress.user_active_review_days is written by the scheduled backfill in
  // progress/activeReviewDays/activeReviewDaysBackfill.ts, and
  // community.public_review_activity_facts by migration 0058 itself, each only for users who
  // already have content.review_events rows. A web guest has none: authoring one needs a sync push,
  // and the default-deny gate in server/requestContext.ts admits a web guest on analytics ingest
  // alone, with guest upgrade refused separately in guestAuth/upgrade/index.ts, and analytics
  // ingest writes only into the analytics schema. auth.user_identities is excluded twice over: it
  // accepts only provider_type = 'cognito' (migration 0031), so a row there means the guest signed
  // in, which the identity-link rule already excludes. The guest's user id is a server-minted
  // randomUUID that is never handed to another actor, so no other user's rows can carry it either.
  // A new writer of any of these tables has to be checked against the review-authorship arm above,
  // not only against the surface gate.
  await deleteUserSettingsInExecutor(executor, candidate.guestUserId);
  return { outcome: "deleted", workspaceId: guestWorkspaceId };
}

/**
 * Deliberately not wrapped in `withTransientDatabaseRetry`, unlike the neighbouring scheduled jobs.
 *
 * The transient set covers exactly the mid-query connection terminations an RDS failover or reboot
 * produces (`57P01`, `57P02`, `08006`, `ECONNRESET`), and one of those can arrive most of the way
 * through a scan. `withReportingReadOnlyTransaction` builds its pool with no
 * `connectionTimeoutMillis` and issues its statements with no `query_timeout`, so a retried attempt
 * is bounded only by the reporting role's server-side 30s and, while the instance is unreachable,
 * by the OS TCP connect timeout. Retrying would therefore let a page begun with exactly
 * `candidateScanBudgetMs` left run past `request.deadlineAtMs`, through the entrypoint's
 * finalization reserve, and into a Lambda hard timeout that loses the whole
 * `web_guest_reaper_completed` record - the loss the reserve exists to prevent.
 *
 * The daily schedule is the retry instead: the run is idempotent and the next run walks the same
 * candidates. The caller catches the failure rather than letting it escape, so a scan that throws
 * costs the run its remaining pages but not the record of the guests it already deleted; it still
 * reaches an operator through `WebGuestReaperLambdaErrorAlarm`, because the entrypoint throws on
 * the `scanFailed` flag once that record is written.
 */
async function loadCandidates(
  inactiveBefore: Date,
  rowLimit: number,
  cursor: WebGuestReaperCursor,
): Promise<ReadonlyArray<WebGuestReaperCandidate>> {
  return withReportingReadOnlyTransaction(async (client) => {
    const executor: ReportingQueryExecutor = {
      query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        return client.query<Row>(text, params as Array<unknown>);
      },
    };
    return loadWebGuestReaperCandidatesInExecutor(executor, inactiveBefore, rowLimit, cursor);
  });
}

/**
 * Separates a guest the run simply ran out of time on from a guest that actually failed.
 *
 * `DatabaseDeadlineExceededError` covers only the deadline that lapses in JavaScript: a pool
 * checkout, or a gap between statements. It is not how a guest transaction is usually stopped.
 * `database/deadline.ts` runs `configureTransactionTimeouts` before every statement and sets a
 * server-side `statement_timeout` of the remaining budget minus a 250ms rollback reserve, plus a
 * `lock_timeout` a millisecond under that, so an overrunning guest is normally stopped by
 * PostgreSQL roughly 250ms before `deadlineAtMs`, while `Date.now()` is still short of it - the raw
 * SQLSTATE then propagates unconverted, because neither code is in the transient set
 * `toDatabaseBoundaryError` converts. Which of the two it is turns only on what the guest was doing
 * when the budget ran out - `57014` for a statement that ran too long, `55P03` for one that waited
 * too long on a lock - and both leave the transaction aborted, so all three stops rolled back and
 * deleted nothing, and all three are the run running out of time on this guest rather than a guest
 * that failed. See guestBudgetExhaustedSqlStates.
 *
 * `DatabaseCommitOutcomeUnknownError` is deliberately excluded. `executeCommit` raises it when the
 * COMMIT itself times out client-side, where the guest may or may not have been deleted, and an
 * unconfirmed outcome on a destructive operation has to reach a human through the failure path.
 */
function isGuestDeadlineInterruption(error: unknown): boolean {
  if (error instanceof DatabaseCommitOutcomeUnknownError) {
    return false;
  }
  if (error instanceof DatabaseDeadlineExceededError) {
    return true;
  }

  const { sqlState } = getDatabaseErrorFields(error);
  return sqlState !== null && guestBudgetExhaustedSqlStates.has(sqlState);
}

async function reapCandidate(
  candidate: WebGuestReaperCandidate,
  inactiveBefore: Date,
  deadlineAtMs: number,
): Promise<WebGuestReaperCandidateOutcome> {
  return runDatabaseOperationsWithDeadline(
    deadlineAtMs,
    () => unsafeTransaction((executor) => reapWebGuestInExecutor(executor, candidate, inactiveBefore)),
  );
}

/**
 * Every warning below is written from inside the page loop, at a point where guests may already
 * have been permanently deleted. A throw out of the capture path would escape
 * `reapInactiveWebGuests` and discard every count for those deletions along with `pagesScanned` and
 * `finished`, which is the same loss the scan-failure catch in the loop exists to prevent.
 * `recordCandidateFailure` is the sharpest case: it sits in the loop's own `catch`, so nothing
 * around it catches anything it throws. Mirrors the guard `database/transient.ts` puts around its
 * own retry breadcrumb.
 */
function captureReaperWarningWithoutThrowing(capture: () => void): void {
  try {
    capture();
  } catch {
    // Observability must not interrupt a run that is permanently deleting rows.
  }
}

function recordCandidateSkip(
  candidate: WebGuestReaperCandidate,
  workspaceId: string | null,
  reason: WebGuestReaperSkipReason,
  observationScope: BackendObservationScope,
): void {
  captureReaperWarningWithoutThrowing(() => {
    captureBackendWarning({
      action: "web_guest_reaper_candidate_skipped",
      message: "Web guest reaper left one inactive guest in place.",
      scope: observationScope,
      details: {
        guestUserId: candidate.guestUserId,
        workspaceId,
        reason,
        lastActiveAtUtc: candidate.lastActiveAt,
      },
    });
  });
}

function recordCandidateFailure(
  candidate: WebGuestReaperCandidate,
  observationScope: BackendObservationScope,
  error: unknown,
): void {
  captureReaperWarningWithoutThrowing(() => {
    const normalizedError = normalizeCaughtError(error);
    captureBackendWarning({
      action: "web_guest_reaper_candidate_failed",
      message: "Web guest reaper failed to delete one inactive guest.",
      scope: observationScope,
      details: {
        guestUserId: candidate.guestUserId,
        lastActiveAtUtc: candidate.lastActiveAt,
        errorClass: normalizedError.name,
        errorMessage: normalizedError.message,
      },
    });
  });
}

function recordScanFailure(
  pagesScanned: number,
  observationScope: BackendObservationScope,
  error: unknown,
): void {
  captureReaperWarningWithoutThrowing(() => {
    const normalizedError = normalizeCaughtError(error);
    captureBackendWarning({
      action: "web_guest_reaper_scan_failed",
      message: "Web guest reaper stopped a run on a failed candidate scan.",
      scope: observationScope,
      details: {
        pagesScanned,
        errorClass: normalizedError.name,
        errorMessage: normalizedError.message,
      },
    });
  });
}

function createEmptyResult(inactiveBefore: Date): WebGuestReaperResult {
  return {
    inactivityThresholdDays: webGuestInactivityThresholdDays,
    inactiveBefore: inactiveBefore.toISOString(),
    pagesScanned: 0,
    candidatesExamined: 0,
    deleted: 0,
    skipped: 0,
    skippedWorkspaceHasContent: 0,
    skippedWorkspaceNotSoleOwned: 0,
    skippedWorkspaceMissing: 0,
    skippedNoLongerCandidate: 0,
    interrupted: 0,
    failed: 0,
    scanFailed: false,
    finished: false,
  };
}

function addSkip(result: WebGuestReaperResult, reason: WebGuestReaperSkipReason): WebGuestReaperResult {
  return {
    ...result,
    skipped: result.skipped + 1,
    skippedWorkspaceHasContent: result.skippedWorkspaceHasContent
      + (reason === "workspace_has_content" ? 1 : 0),
    skippedWorkspaceNotSoleOwned: result.skippedWorkspaceNotSoleOwned
      + (reason === "workspace_not_sole_owned" ? 1 : 0),
    skippedWorkspaceMissing: result.skippedWorkspaceMissing
      + (reason === "workspace_missing" ? 1 : 0),
    skippedNoLongerCandidate: result.skippedNoLongerCandidate
      + (reason === "no_longer_a_candidate" ? 1 : 0),
  };
}

/**
 * Walks the candidate ordering page by page until it runs out of candidates, out of pages, or out
 * of time. `finished` is the saturation signal: a run that returns `false` left candidates behind,
 * which is the difference between "web guests are no longer accumulating" and "they are being
 * minted faster than this schedule reaps them", and no other emitted counter can tell those apart.
 */
export async function reapInactiveWebGuests(
  request: WebGuestReaperRequest,
  observationScope: BackendObservationScope,
): Promise<WebGuestReaperResult> {
  const batchSize = requireIntegerInRange(request.batchSize, "batchSize", minimumBatchSize, maximumBatchSize);
  const maxPages = requireIntegerInRange(request.maxPages, "maxPages", minimumMaxPages, maximumMaxPages);
  const inactiveBefore = calculateWebGuestInactiveBefore(Date.now());
  let result = createEmptyResult(inactiveBefore);
  let cursor: WebGuestReaperCursor = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    // The candidate scan is the slowest statement in the run, so the deadline is checked before
    // paying for another one rather than only between guests, and a page is started only with a
    // full scan budget left rather than with whatever remains.
    if (request.deadlineAtMs - Date.now() < candidateScanBudgetMs) {
      return result;
    }

    // One row past the page is read and never processed. It is the cheapest exact answer to "were
    // candidates left behind": a page that comes back full says nothing on its own, so a candidate
    // count that is an exact multiple of batchSize would make the last page of a run that also used
    // its last maxPages look saturated while nothing at all remained, and raise
    // WebGuestReaperSaturatedAlarm on a run that did its whole job.
    let page: ReadonlyArray<WebGuestReaperCandidate>;
    try {
      page = await loadCandidates(inactiveBefore, batchSize + 1, cursor);
    } catch (error) {
      // Everything earlier pages deleted is already permanent, so a scan that throws must not carry
      // those counts out with it: the run stops here and still reports what it deleted, skipped and
      // failed, with finished left false so WebGuestReaperSaturatedAlarm sees the candidates left
      // behind. The invocation still has to fail, so the entrypoint throws on scanFailed after
      // emitting the completion record.
      recordScanFailure(result.pagesScanned, observationScope, error);
      return { ...result, scanFailed: true };
    }

    const hasMoreCandidates = page.length > batchSize;
    const candidates = hasMoreCandidates ? page.slice(0, batchSize) : page;
    result = { ...result, pagesScanned: result.pagesScanned + 1 };

    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (request.deadlineAtMs - Date.now() < guestDeadlineMs) {
        return { ...result, interrupted: candidates.length - candidateIndex };
      }

      const guestDeadlineAtMs = Date.now() + guestDeadlineMs;
      cursor = createCursorFromCandidate(candidate);
      try {
        const outcome = await reapCandidate(candidate, inactiveBefore, guestDeadlineAtMs);
        result = { ...result, candidatesExamined: result.candidatesExamined + 1 };
        if (outcome.outcome === "skipped") {
          recordCandidateSkip(candidate, outcome.workspaceId, outcome.reason, observationScope);
          result = addSkip(result, outcome.reason);
          continue;
        }

        result = { ...result, deleted: result.deleted + 1 };
      } catch (error) {
        // A guest budget that runs out inside the guest's own transaction rolled that transaction
        // back and deleted nothing, so the run simply ran out of time on this guest. Counting it as
        // a failure would send a normal deadline stop to the Lambda error alarm, because the
        // entrypoint turns any failed guest into a thrown error.
        if (isGuestDeadlineInterruption(error)) {
          return { ...result, interrupted: candidates.length - candidateIndex };
        }

        recordCandidateFailure(candidate, observationScope, error);
        result = {
          ...result,
          candidatesExamined: result.candidatesExamined + 1,
          failed: result.failed + 1,
        };
      }
    }

    if (!hasMoreCandidates) {
      return { ...result, finished: true };
    }
  }

  return result;
}
