import type pg from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
} from "../database";
import { withTransientDatabaseRetry } from "../database/transient";
import { unsafeRepeatableReadTransaction, unsafeTransaction } from "../database/unsafe";
import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import {
  captureBackendWarning,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import {
  materializeMissingActiveReviewDaysForUserInExecutor,
  type ActiveReviewDayMaterializationResult,
} from "./activeReviewDays";

export type ActiveReviewDaysBackfillCursor = Readonly<{
  userId: string;
  workspaceId: string;
}> | null;

export type ActiveReviewDaysBackfillCandidate = Readonly<{
  userId: string;
  workspaceId: string;
  progressTimeZone: string;
  missingReviewLocalDateCount: number;
  missingActiveReviewDayCount: number;
}>;

export type ActiveReviewDaysBackfillCandidatePageInput = Readonly<{
  cursor: ActiveReviewDaysBackfillCursor;
  batchSize: number;
}>;

export type ActiveReviewDaysBackfillCandidatePage = Readonly<{
  candidates: ReadonlyArray<ActiveReviewDaysBackfillCandidate>;
  nextCursor: ActiveReviewDaysBackfillCursor;
  candidateKeyCount: number;
  scannedUserIds: ReadonlyArray<string>;
}>;

export type ActiveReviewDaysBackfillRequest = Readonly<{
  batchSize: number;
  maxPages: number;
}>;

export type ActiveReviewDaysBackfillResult = Readonly<{
  pagesScanned: number;
  usersScanned: number;
  usersMaterialized: number;
  reviewEventsMaterialized: number;
  activeReviewDaysUpserted: number;
  skippedUsers: number;
  errors: number;
  finished: boolean;
}>;

export type ActiveReviewDaysBackfillDependencies = Readonly<{
  loadCursor: (observationScope: BackendObservationScope) => Promise<ActiveReviewDaysBackfillCursor>;
  saveCursor: (
    cursor: ActiveReviewDaysBackfillCursor,
    observationScope: BackendObservationScope,
  ) => Promise<void>;
  loadCandidatePage: (
    cursor: ActiveReviewDaysBackfillCursor,
    batchSize: number,
    observationScope: BackendObservationScope,
  ) => Promise<ActiveReviewDaysBackfillCandidatePage>;
  materializeCandidate: (
    candidate: ActiveReviewDaysBackfillCandidate,
    observationScope: BackendObservationScope,
  ) => Promise<ActiveReviewDayMaterializationResult>;
}>;

type ActiveReviewDaysBackfillCandidateRow = Readonly<{
  user_id: string;
  workspace_id: string;
  progress_time_zone: string;
  missing_review_local_date_count: string | number;
  missing_active_review_day_count: string | number;
}>;

type ActiveReviewDaysBackfillCandidateKey = Readonly<{
  userId: string;
  workspaceId: string;
  progressTimeZone: string;
}>;

type ActiveReviewDaysBackfillCandidateKeyRow = Readonly<{
  user_id: string;
  workspace_id: string;
  progress_time_zone: string;
}>;

type ActiveReviewDaysBackfillCursorRow = Readonly<{
  cursor_user_id: string | null;
  cursor_workspace_id: string | null;
}>;

type ReportingQueryExecutor = Readonly<{
  query<Row extends pg.QueryResultRow>(
    text: string,
    params: ReadonlyArray<SqlValue>,
  ): Promise<pg.QueryResult<Row>>;
}>;

const minimumBatchSize = 1;
const maximumBatchSize = 100;
const minimumMaxPages = 1;
const maximumMaxPages = 100;
const activeReviewDaysBackfillStateJobName = "progress_active_days_backfill";

function parseNonNegativeDatabaseInteger(value: string | number, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Database ${fieldName} must be a non-negative integer: ${value}`);
  }

  return parsedValue;
}

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

function validateBackfillRequest(request: ActiveReviewDaysBackfillRequest): ActiveReviewDaysBackfillRequest {
  return {
    batchSize: requireIntegerInRange(request.batchSize, "batchSize", minimumBatchSize, maximumBatchSize),
    maxPages: requireIntegerInRange(request.maxPages, "maxPages", minimumMaxPages, maximumMaxPages),
  };
}

function mapCandidateRow(row: ActiveReviewDaysBackfillCandidateRow): ActiveReviewDaysBackfillCandidate {
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    progressTimeZone: row.progress_time_zone,
    missingReviewLocalDateCount: parseNonNegativeDatabaseInteger(
      row.missing_review_local_date_count,
      "missing_review_local_date_count",
    ),
    missingActiveReviewDayCount: parseNonNegativeDatabaseInteger(
      row.missing_active_review_day_count,
      "missing_active_review_day_count",
    ),
  };
}

function mapCandidateKeyRow(row: ActiveReviewDaysBackfillCandidateKeyRow): ActiveReviewDaysBackfillCandidateKey {
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    progressTimeZone: row.progress_time_zone,
  };
}

function createNextCursorFromCandidateKeys(
  candidateKeys: ReadonlyArray<ActiveReviewDaysBackfillCandidateKey>,
): ActiveReviewDaysBackfillCursor {
  const lastCandidateKey = candidateKeys.at(-1);
  if (lastCandidateKey === undefined) {
    return null;
  }

  return {
    userId: lastCandidateKey.userId,
    workspaceId: lastCandidateKey.workspaceId,
  };
}

function mapCursorRow(row: ActiveReviewDaysBackfillCursorRow): ActiveReviewDaysBackfillCursor {
  if (row.cursor_user_id === null && row.cursor_workspace_id === null) {
    return null;
  }

  if (row.cursor_user_id === null || row.cursor_workspace_id === null) {
    throw new Error("Progress active-day backfill cursor state must store both cursor_user_id and cursor_workspace_id");
  }

  return {
    userId: row.cursor_user_id,
    workspaceId: row.cursor_workspace_id,
  };
}

function requireNextCursorForFullPage(
  nextCursor: ActiveReviewDaysBackfillCursor,
): Exclude<ActiveReviewDaysBackfillCursor, null> {
  if (nextCursor === null) {
    throw new Error("Progress active-day backfill full candidate key page must return a next cursor");
  }

  return nextCursor;
}

function createCandidateKeyValuesSql(candidateKeys: ReadonlyArray<ActiveReviewDaysBackfillCandidateKey>): string {
  return candidateKeys
    .map((_candidateKey, index) => {
      const userIdParameterIndex = index * 3 + 1;
      const workspaceIdParameterIndex = userIdParameterIndex + 1;
      const progressTimeZoneParameterIndex = userIdParameterIndex + 2;
      return `($${userIdParameterIndex}::text, $${workspaceIdParameterIndex}::uuid, $${progressTimeZoneParameterIndex}::text)`;
    })
    .join(", ");
}

function createCandidateKeyValuesParams(
  candidateKeys: ReadonlyArray<ActiveReviewDaysBackfillCandidateKey>,
): ReadonlyArray<SqlValue> {
  return candidateKeys.flatMap((candidateKey) => [
    candidateKey.userId,
    candidateKey.workspaceId,
    candidateKey.progressTimeZone,
  ]);
}

function hasMaterializedRows(result: ActiveReviewDayMaterializationResult): boolean {
  return result.reviewEventsMaterialized > 0 || result.activeReviewDaysUpserted > 0;
}

function addMaterializationResult(
  left: ActiveReviewDaysBackfillResult,
  right: ActiveReviewDayMaterializationResult,
): ActiveReviewDaysBackfillResult {
  return {
    ...left,
    reviewEventsMaterialized: left.reviewEventsMaterialized + right.reviewEventsMaterialized,
    activeReviewDaysUpserted: left.activeReviewDaysUpserted + right.activeReviewDaysUpserted,
  };
}

export async function loadActiveReviewDaysBackfillCursorInExecutor(
  executor: DatabaseExecutor,
): Promise<ActiveReviewDaysBackfillCursor> {
  const result = await executor.query<ActiveReviewDaysBackfillCursorRow>(
    [
      "SELECT",
      "cursor_user_id,",
      "cursor_workspace_id::text AS cursor_workspace_id",
      "FROM progress.active_review_days_backfill_state",
      "WHERE job_name = $1",
    ].join(" "),
    [activeReviewDaysBackfillStateJobName],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return mapCursorRow(row);
}

export async function saveActiveReviewDaysBackfillCursorInExecutor(
  executor: DatabaseExecutor,
  cursor: ActiveReviewDaysBackfillCursor,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO progress.active_review_days_backfill_state AS state",
      "(job_name, cursor_user_id, cursor_workspace_id)",
      "VALUES ($1, $2, $3::uuid)",
      "ON CONFLICT (job_name)",
      "DO UPDATE SET",
      "cursor_user_id = EXCLUDED.cursor_user_id,",
      "cursor_workspace_id = EXCLUDED.cursor_workspace_id,",
      "updated_at = now()",
    ].join(" "),
    [
      activeReviewDaysBackfillStateJobName,
      cursor?.userId ?? null,
      cursor?.workspaceId ?? null,
    ],
  );
}

function createEmptyBackfillResult(): ActiveReviewDaysBackfillResult {
  return {
    pagesScanned: 0,
    usersScanned: 0,
    usersMaterialized: 0,
    reviewEventsMaterialized: 0,
    activeReviewDaysUpserted: 0,
    skippedUsers: 0,
    errors: 0,
    finished: false,
  };
}

function countSkippedUsers(
  skippedUserIds: ReadonlySet<string>,
  materializedUserIds: ReadonlySet<string>,
): number {
  return [...skippedUserIds].filter((userId) => !materializedUserIds.has(userId)).length;
}

function createCandidateFailureWarningDetails(
  candidate: ActiveReviewDaysBackfillCandidate,
  error: Error,
): Readonly<{
  userId: string;
  workspaceId: string;
  progressTimeZone: string;
  missingReviewLocalDateCount: number;
  missingActiveReviewDayCount: number;
  errorClass: string;
  errorMessage: string;
}> {
  return {
    userId: candidate.userId,
    workspaceId: candidate.workspaceId,
    progressTimeZone: candidate.progressTimeZone,
    missingReviewLocalDateCount: candidate.missingReviewLocalDateCount,
    missingActiveReviewDayCount: candidate.missingActiveReviewDayCount,
    errorClass: error.name,
    errorMessage: error.message,
  };
}

function recordCandidateFailure(
  candidate: ActiveReviewDaysBackfillCandidate,
  observationScope: BackendObservationScope,
  error: unknown,
): void {
  const normalizedError = normalizeCaughtError(error);
  captureBackendWarning({
    action: "progress_active_days_backfill_candidate_failed",
    message: "Progress active-day backfill failed for one candidate user/workspace.",
    scope: observationScope,
    details: createCandidateFailureWarningDetails(candidate, normalizedError),
  });
}

async function materializeCandidate(
  candidate: ActiveReviewDaysBackfillCandidate,
  observationScope: BackendObservationScope,
): Promise<ActiveReviewDayMaterializationResult> {
  return withTransientDatabaseRetry(
    () => unsafeRepeatableReadTransaction(async (executor) => {
      await applyWorkspaceDatabaseScopeInExecutor(executor, {
        userId: candidate.userId,
        workspaceId: candidate.workspaceId,
      });
      return materializeMissingActiveReviewDaysForUserInExecutor(
        executor,
        candidate.userId,
        candidate.workspaceId,
        candidate.progressTimeZone,
      );
    }),
    () => observationScope,
  );
}

async function loadStoredCursor(
  observationScope: BackendObservationScope,
): Promise<ActiveReviewDaysBackfillCursor> {
  return withTransientDatabaseRetry(
    () => unsafeTransaction((executor) => loadActiveReviewDaysBackfillCursorInExecutor(executor)),
    () => observationScope,
  );
}

async function saveStoredCursor(
  cursor: ActiveReviewDaysBackfillCursor,
  observationScope: BackendObservationScope,
): Promise<void> {
  await withTransientDatabaseRetry(
    () => unsafeTransaction((executor) => saveActiveReviewDaysBackfillCursorInExecutor(executor, cursor)),
    () => observationScope,
  );
}

export async function loadActiveReviewDaysBackfillCandidatePageInExecutor(
  executor: DatabaseExecutor,
  input: ActiveReviewDaysBackfillCandidatePageInput,
): Promise<ActiveReviewDaysBackfillCandidatePage> {
  const batchSize = requireIntegerInRange(input.batchSize, "batchSize", minimumBatchSize, maximumBatchSize);
  // Users without a known Progress timezone are intentionally skipped until a
  // Progress request records one; this job must not mass-materialize with UTC.
  const candidateKeyResult = await executor.query<ActiveReviewDaysBackfillCandidateKeyRow>(
    [
      "SELECT",
      "review_events.reviewed_by_user_id AS user_id,",
      "review_events.workspace_id::text AS workspace_id,",
      "user_settings.progress_time_zone",
      "FROM content.review_events AS review_events",
      "INNER JOIN org.user_settings AS user_settings",
      "ON user_settings.user_id = review_events.reviewed_by_user_id",
      "WHERE user_settings.progress_time_zone IS NOT NULL",
      "AND review_events.reviewed_by_user_id IS NOT NULL",
      "AND (",
      "$1::text IS NULL",
      "OR (review_events.reviewed_by_user_id, review_events.workspace_id) > ($1::text, $2::uuid)",
      ")",
      "GROUP BY review_events.reviewed_by_user_id, review_events.workspace_id, user_settings.progress_time_zone",
      "ORDER BY review_events.reviewed_by_user_id ASC, review_events.workspace_id ASC",
      "LIMIT $3",
    ].join(" "),
    [input.cursor?.userId ?? null, input.cursor?.workspaceId ?? null, batchSize],
  );
  const candidateKeys = candidateKeyResult.rows.map(mapCandidateKeyRow);
  if (candidateKeys.length === 0) {
    return {
      candidates: [],
      nextCursor: null,
      candidateKeyCount: 0,
      scannedUserIds: [],
    };
  }

  const result = await executor.query<ActiveReviewDaysBackfillCandidateRow>(
    [
      `WITH candidate_keys(user_id, workspace_id, progress_time_zone) AS (VALUES ${createCandidateKeyValuesSql(candidateKeys)}),`,
      "review_events_with_gap_state AS (",
      "SELECT",
      "candidate_keys.user_id,",
      "candidate_keys.workspace_id::text AS workspace_id,",
      "candidate_keys.progress_time_zone,",
      "review_events.reviewed_local_date,",
      "COALESCE(",
      "review_events.reviewed_local_date,",
      "timezone(COALESCE(review_events.reviewed_time_zone, candidate_keys.progress_time_zone),",
      "review_events.reviewed_at_client)::date",
      ") AS materialized_local_date,",
      "active_days.local_date AS active_day_local_date",
      "FROM candidate_keys",
      "INNER JOIN content.review_events AS review_events",
      "ON review_events.reviewed_by_user_id = candidate_keys.user_id",
      "AND review_events.workspace_id = candidate_keys.workspace_id",
      "LEFT JOIN progress.user_active_review_days AS active_days",
      "ON active_days.reviewed_by_user_id = review_events.reviewed_by_user_id",
      "AND active_days.local_date = COALESCE(",
      "review_events.reviewed_local_date,",
      "timezone(COALESCE(review_events.reviewed_time_zone, candidate_keys.progress_time_zone),",
      "review_events.reviewed_at_client)::date",
      ")",
      ")",
      "SELECT",
      "user_id,",
      "workspace_id,",
      "progress_time_zone,",
      "COUNT(*) FILTER (WHERE reviewed_local_date IS NULL)::int AS missing_review_local_date_count,",
      "COUNT(DISTINCT materialized_local_date) FILTER (WHERE active_day_local_date IS NULL)::int",
      "AS missing_active_review_day_count",
      "FROM review_events_with_gap_state",
      "WHERE reviewed_local_date IS NULL OR active_day_local_date IS NULL",
      "GROUP BY user_id, workspace_id, progress_time_zone",
      "ORDER BY user_id ASC, workspace_id ASC",
    ].join(" "),
    createCandidateKeyValuesParams(candidateKeys),
  );
  const candidates = result.rows.map(mapCandidateRow);

  return {
    candidates,
    nextCursor: createNextCursorFromCandidateKeys(candidateKeys),
    candidateKeyCount: candidateKeys.length,
    scannedUserIds: [...new Set(candidateKeys.map((candidateKey) => candidateKey.userId))],
  };
}

async function loadCandidatePage(
  cursor: ActiveReviewDaysBackfillCursor,
  batchSize: number,
  observationScope: BackendObservationScope,
): Promise<ActiveReviewDaysBackfillCandidatePage> {
  return withTransientDatabaseRetry(
    () => withReportingReadOnlyTransaction(async (client) => {
      const executor: ReportingQueryExecutor = {
        query<Row extends pg.QueryResultRow>(
          text: string,
          params: ReadonlyArray<SqlValue>,
        ): Promise<pg.QueryResult<Row>> {
          return client.query<Row>(text, params as Array<unknown>);
        },
      };
      return loadActiveReviewDaysBackfillCandidatePageInExecutor(executor, { cursor, batchSize });
    }),
    () => observationScope,
  );
}

export async function backfillActiveReviewDaysWithDependencies(
  request: ActiveReviewDaysBackfillRequest,
  observationScope: BackendObservationScope,
  dependencies: ActiveReviewDaysBackfillDependencies,
): Promise<ActiveReviewDaysBackfillResult> {
  const validRequest = validateBackfillRequest(request);
  let result = createEmptyBackfillResult();
  let cursor = await dependencies.loadCursor(observationScope);
  const scannedUserIds = new Set<string>();
  const materializedUserIds = new Set<string>();
  const skippedUserIds = new Set<string>();

  for (let pageIndex = 0; pageIndex < validRequest.maxPages; pageIndex += 1) {
    const page = await dependencies.loadCandidatePage(cursor, validRequest.batchSize, observationScope);
    result = {
      ...result,
      pagesScanned: result.pagesScanned + 1,
    };
    for (const scannedUserId of page.scannedUserIds) {
      scannedUserIds.add(scannedUserId);
    }

    if (page.candidateKeyCount === 0) {
      await dependencies.saveCursor(null, observationScope);
      return {
        ...result,
        usersScanned: scannedUserIds.size,
        usersMaterialized: materializedUserIds.size,
        skippedUsers: countSkippedUsers(skippedUserIds, materializedUserIds),
        finished: true,
      };
    }

    const candidateUserIds = new Set(page.candidates.map((candidate) => candidate.userId));
    for (const scannedUserId of page.scannedUserIds) {
      if (!candidateUserIds.has(scannedUserId)) {
        skippedUserIds.add(scannedUserId);
      }
    }

    for (const candidate of page.candidates) {
      scannedUserIds.add(candidate.userId);
      try {
        const materializationResult = await dependencies.materializeCandidate(candidate, observationScope);
        result = addMaterializationResult(result, materializationResult);
        if (hasMaterializedRows(materializationResult)) {
          materializedUserIds.add(candidate.userId);
        } else {
          skippedUserIds.add(candidate.userId);
        }
      } catch (error) {
        recordCandidateFailure(candidate, observationScope, error);
        result = {
          ...result,
          errors: result.errors + 1,
        };
      }
    }

    cursor = page.candidateKeyCount < validRequest.batchSize
      ? null
      : requireNextCursorForFullPage(page.nextCursor);
    await dependencies.saveCursor(cursor, observationScope);
    if (page.candidateKeyCount < validRequest.batchSize) {
      return {
        ...result,
        usersScanned: scannedUserIds.size,
        usersMaterialized: materializedUserIds.size,
        skippedUsers: countSkippedUsers(skippedUserIds, materializedUserIds),
        finished: true,
      };
    }
  }

  return {
    ...result,
    usersScanned: scannedUserIds.size,
    usersMaterialized: materializedUserIds.size,
    skippedUsers: countSkippedUsers(skippedUserIds, materializedUserIds),
    finished: false,
  };
}

export async function backfillActiveReviewDays(
  request: ActiveReviewDaysBackfillRequest,
  observationScope: BackendObservationScope,
): Promise<ActiveReviewDaysBackfillResult> {
  return backfillActiveReviewDaysWithDependencies(request, observationScope, {
    loadCursor: loadStoredCursor,
    saveCursor: saveStoredCursor,
    loadCandidatePage,
    materializeCandidate,
  });
}
