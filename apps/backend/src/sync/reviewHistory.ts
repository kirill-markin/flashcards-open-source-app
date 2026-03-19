import { appendReviewEventSnapshotInExecutor } from "../cards";
import {
  queryWithWorkspaceScope,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../db";
import {
  ensureSyncDevice,
  type SyncDevicePlatform,
} from "../devices";
import { HttpError } from "../errors";
import type {
  SyncReviewHistoryImportInput,
  SyncReviewHistoryPullInput,
} from "./input";
import type {
  ReviewHistoryRow,
  ReviewSequenceRow,
  SyncReviewHistoryImportResult,
  SyncReviewHistoryPullResult,
  TimestampValue,
} from "./types";

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toIsoString(value: TimestampValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadCurrentReviewSequenceId(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<ReviewSequenceRow>(
    [
      "SELECT COALESCE(MAX(review_sequence), 0) AS review_sequence",
      "FROM content.review_events",
      "WHERE workspace_id = $1",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Failed to load current review sequence id");
  }

  return toNumber(row.review_sequence) ?? 0;
}

export function mapReviewHistoryRows(rows: ReadonlyArray<ReviewHistoryRow>): ReadonlyArray<import("../cards").ReviewEvent> {
  return rows.map((row) => ({
    reviewEventId: row.review_event_id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    deviceId: row.device_id,
    clientEventId: row.client_event_id,
    rating: row.rating,
    reviewedAtClient: toIsoString(row.reviewed_at_client),
    reviewedAtServer: toIsoString(row.reviewed_at_server),
  }));
}

export async function processSyncReviewHistoryImportInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  deviceId: string,
  input: SyncReviewHistoryImportInput,
): Promise<SyncReviewHistoryImportResult> {
  let importedCount = 0;
  let duplicateCount = 0;

  for (const reviewEvent of input.reviewEvents) {
    if (reviewEvent.deviceId !== deviceId) {
      throw new HttpError(400, "reviewEvent.deviceId must match the authenticated sync deviceId");
    }

    const mutation = await appendReviewEventSnapshotInExecutor(
      executor,
      workspaceId,
      {
        reviewEventId: reviewEvent.reviewEventId,
        workspaceId,
        cardId: reviewEvent.cardId,
        deviceId: reviewEvent.deviceId,
        clientEventId: reviewEvent.clientEventId,
        rating: reviewEvent.rating,
        reviewedAtClient: reviewEvent.reviewedAtClient,
        reviewedAtServer: reviewEvent.reviewedAtServer,
      },
      reviewEvent.reviewEventId,
    );

    if (mutation.applied) {
      importedCount += 1;
    } else {
      duplicateCount += 1;
    }
  }

  return {
    importedCount,
    duplicateCount,
    nextReviewSequenceId: await loadCurrentReviewSequenceId(executor, workspaceId),
  };
}

export async function processSyncReviewHistoryPull(
  workspaceId: string,
  userId: string,
  input: SyncReviewHistoryPullInput,
): Promise<SyncReviewHistoryPullResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  const result = await queryWithWorkspaceScope<ReviewHistoryRow>(
    { userId, workspaceId },
    [
      "SELECT review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server, review_sequence",
      "FROM content.review_events",
      "WHERE workspace_id = $1 AND review_sequence > $2",
      "ORDER BY review_sequence ASC",
      "LIMIT $3",
    ].join(" "),
    [workspaceId, input.afterReviewSequenceId, input.limit + 1],
  );

  const hasMore = result.rows.length > input.limit;
  const visibleRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
  const reviewEvents = mapReviewHistoryRows(visibleRows);
  const nextReviewSequenceId = visibleRows.length === 0
    ? input.afterReviewSequenceId
    : toNumber(visibleRows[visibleRows.length - 1].review_sequence) ?? input.afterReviewSequenceId;

  return {
    reviewEvents,
    nextReviewSequenceId,
    hasMore,
  };
}

export async function processSyncReviewHistoryImport(
  workspaceId: string,
  userId: string,
  input: SyncReviewHistoryImportInput,
): Promise<SyncReviewHistoryImportResult> {
  await ensureSyncDevice(
    workspaceId,
    userId,
    input.deviceId,
    input.platform as SyncDevicePlatform,
    input.appVersion ?? null,
  );

  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => processSyncReviewHistoryImportInExecutor(executor, workspaceId, input.deviceId, input),
  );
}
