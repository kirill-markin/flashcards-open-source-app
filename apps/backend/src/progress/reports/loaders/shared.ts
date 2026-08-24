import type { DatabaseExecutor } from "../../../database";
import type { ProgressReviewHistoryWatermark } from "../contracts";

type ReviewHistoryWatermarkRow = Readonly<{
  workspace_id: string;
  review_sequence_id: string | number;
}>;

export function normalizeNonNegativeIntegerFromQuery(value: string | number, fieldName: string): number {
  const normalizedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(`Invalid non-negative integer returned for ${fieldName}`);
  }

  return normalizedValue;
}

function parseReviewSequenceId(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return Number.NaN;
  }

  return Number.parseInt(trimmedValue, 10);
}

function normalizeReviewSequenceId(value: string | number, workspaceId: string): number {
  const normalizedValue = parseReviewSequenceId(value);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw new Error(
      `Invalid review_sequence returned for progress watermark: workspaceId=${workspaceId}, value=${String(value)}`,
    );
  }

  return normalizedValue;
}

function mapReviewHistoryWatermarkRow(row: ReviewHistoryWatermarkRow): ProgressReviewHistoryWatermark {
  const workspaceId = row.workspace_id.trim();
  if (workspaceId === "") {
    throw new Error("Invalid workspace_id returned for progress watermark");
  }

  return {
    workspaceId,
    reviewSequenceId: normalizeReviewSequenceId(row.review_sequence_id, workspaceId),
  };
}

function createSortedWorkspaceIds(workspaceIds: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right));
}

function assertWatermarkRowsCoverWorkspaceIds(
  workspaceIds: ReadonlyArray<string>,
  rows: ReadonlyArray<ReviewHistoryWatermarkRow>,
): void {
  const expectedWorkspaceIds = createSortedWorkspaceIds(workspaceIds);
  const actualWorkspaceIds = createSortedWorkspaceIds(rows.map((row) => row.workspace_id));
  const hasMismatchedWorkspaceIds = expectedWorkspaceIds.length !== actualWorkspaceIds.length
    || expectedWorkspaceIds.some((workspaceId, index) => workspaceId !== actualWorkspaceIds[index]);

  if (hasMismatchedWorkspaceIds) {
    throw new Error(
      [
        "Review-history watermark query did not return one row per workspace",
        `expectedWorkspaceIds=${expectedWorkspaceIds.join(",")}`,
        `returnedWorkspaceIds=${actualWorkspaceIds.join(",")}`,
      ].join("; "),
    );
  }
}

export function sortReviewHistoryWatermarks(
  watermarks: ReadonlyArray<ProgressReviewHistoryWatermark>,
): ReadonlyArray<ProgressReviewHistoryWatermark> {
  return [...watermarks].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

export async function loadReviewHistoryWatermarksInExecutor(
  executor: DatabaseExecutor,
  workspaceIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<ProgressReviewHistoryWatermark>> {
  if (workspaceIds.length === 0) {
    return [];
  }

  const result = await executor.query<ReviewHistoryWatermarkRow>(
    [
      "WITH requested_workspaces AS (",
      "SELECT requested_workspace_ids.workspace_id",
      "FROM unnest($1::uuid[]) AS requested_workspace_ids(workspace_id)",
      "WHERE security.current_workspace_access_allowed(requested_workspace_ids.workspace_id)",
      ")",
      "SELECT",
      "requested_workspaces.workspace_id::text AS workspace_id,",
      "COALESCE(MAX(review_events.review_sequence), 0) AS review_sequence_id",
      "FROM requested_workspaces",
      "LEFT JOIN content.review_events AS review_events",
      "ON review_events.workspace_id = requested_workspaces.workspace_id",
      "GROUP BY requested_workspaces.workspace_id",
      "ORDER BY requested_workspaces.workspace_id ASC",
    ].join(" "),
    [workspaceIds],
  );

  assertWatermarkRowsCoverWorkspaceIds(workspaceIds, result.rows);
  return result.rows.map(mapReviewHistoryWatermarkRow);
}
