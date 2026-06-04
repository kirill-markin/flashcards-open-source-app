import { pushSyncOperations } from "../../../api";
import { webAppVersion } from "../../../clientIdentity";
import {
  deleteOutboxRecord,
  isScheduleRelevantCardOutboxRecord,
  listOutboxRecords,
  putOutboxRecord,
  type PersistedOutboxRecord,
} from "../../../localDb/sync/outbox";
import type { SyncPushResult } from "../../../types";
import { getErrorMessage } from "../../domain";
import type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

function isProgressReviewEventOperation(
  record: PersistedOutboxRecord,
): boolean {
  return record.operation.entityType === "review_event" && record.operation.action === "append";
}

function isAcknowledgedPushStatus(status: SyncPushResult["operations"][number]["status"]): boolean {
  return status === "applied" || status === "ignored" || status === "duplicate";
}

export async function pushOutbox(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let currentOutbox = await listOutboxRecords(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeProgressHistory = false;
  let didChangeReviewSchedule = false;

  while (currentOutbox.length > 0) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const batch = currentOutbox.slice(0, 100);
    const batchIncludesProgressReviewEvents = batch.some(isProgressReviewEventOperation);
    const reviewScheduleOperationIds = new Set(
      batch
        .filter(isScheduleRelevantCardOutboxRecord)
        .map((record) => record.operationId),
    );
    try {
      const pushResult = await pushSyncOperations(
        input.workspaceId,
        input.installationId,
        "web",
        webAppVersion,
        batch.map((record) => record.operation),
      );
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

      for (const result of pushResult.operations) {
        if (isAcknowledgedPushStatus(result.status)) {
          input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
          await deleteOutboxRecord(input.workspaceId, result.operationId);
          if (reviewScheduleOperationIds.has(result.operationId)) {
            didChangeReviewSchedule = true;
          }
        }
      }

      if (batchIncludesProgressReviewEvents) {
        didChangeProgressHistory = true;
      }
    } catch (error) {
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      const errorMessage = getErrorMessage(error);
      for (const record of batch) {
        input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
        await putOutboxRecord({
          ...record,
          attemptCount: record.attemptCount + 1,
          lastError: errorMessage,
        });
      }
      throw error;
    }

    currentOutbox = await listOutboxRecords(input.workspaceId);
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  }

  return {
    didChangeProgressHistory,
    didChangeReviewSchedule,
  };
}
