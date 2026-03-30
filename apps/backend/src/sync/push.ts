import {
  appendReviewEventSnapshotInExecutor,
  upsertCardSnapshotInExecutor,
} from "../cards";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../db";
import { upsertDeckSnapshotInExecutor } from "../decks";
import { normalizeIsoTimestamp } from "../lww";
import { ensureWorkspaceReplica } from "../syncIdentity";
import { ensureWorkspaceSyncMetadataInExecutor } from "../syncChanges";
import { applyWorkspaceSchedulerSettingsSnapshotInExecutor } from "../workspaceSchedulerSettings";
import type {
  SyncPushInput,
  SyncPushOperation,
} from "./input";
import {
  toCardMutationMetadata,
  toCardSnapshotInput,
  toDeckMutationMetadata,
  toDeckSnapshotInput,
  toWorkspaceSchedulerSettingsMutationMetadata,
  toWorkspaceSchedulerSettingsSnapshotInput,
} from "./snapshots";
import type {
  AppliedOperationRow,
  SyncPushOperationResult,
  SyncPushResult,
} from "./types";

function toNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

async function loadExistingAppliedOperations(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
  operationIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, number | null>> {
  if (operationIds.length === 0) {
    return new Map();
  }

  const result = await executor.query<AppliedOperationRow>(
    [
      "SELECT DISTINCT ON (operation_id) operation_id, resulting_hot_change_id",
      "FROM sync.applied_operations_current",
      "WHERE workspace_id = $1 AND replica_id = $2 AND operation_id = ANY($3::text[])",
      "ORDER BY operation_id ASC, applied_at DESC",
    ].join(" "),
    [workspaceId, replicaId, [...operationIds]],
  );

  return new Map(result.rows.map((row) => [row.operation_id, toNumber(row.resulting_hot_change_id)]));
}

async function recordAppliedOperation(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
  operation: SyncPushOperation,
  resultingHotChangeId: number | null,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO sync.applied_operations_current",
      "(",
      "workspace_id, replica_id, operation_id, operation_type, entity_type, entity_id, client_updated_at, resulting_hot_change_id, applied_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())",
    ].join(" "),
    [
      workspaceId,
      replicaId,
      operation.operationId,
      operation.action,
      operation.entityType,
      operation.entityId,
      normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt"),
      resultingHotChangeId,
    ],
  );
}

export async function processOperationInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
  operation: SyncPushOperation,
): Promise<SyncPushOperationResult> {
  let resultingHotChangeId: number | null = null;
  let status: SyncPushOperationResult["status"] = "applied";

  if (operation.entityType === "card") {
    if (operation.entityId !== operation.payload.cardId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "card entityId must match payload.cardId",
      };
    }

    const mutation = await upsertCardSnapshotInExecutor(
      executor,
      workspaceId,
      toCardSnapshotInput(operation.payload),
      toCardMutationMetadata({
        clientUpdatedAt: operation.clientUpdatedAt,
        lastModifiedByReplicaId: replicaId,
        lastOperationId: operation.operationId,
      }),
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = mutation.changeId;
  } else if (operation.entityType === "deck") {
    if (operation.entityId !== operation.payload.deckId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "deck entityId must match payload.deckId",
      };
    }

    const mutation = await upsertDeckSnapshotInExecutor(
      executor,
      workspaceId,
      toDeckSnapshotInput(operation.payload),
      toDeckMutationMetadata({
        clientUpdatedAt: operation.clientUpdatedAt,
        lastModifiedByReplicaId: replicaId,
        lastOperationId: operation.operationId,
      }),
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = mutation.changeId;
  } else if (operation.entityType === "workspace_scheduler_settings") {
    if (operation.entityId !== workspaceId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "workspace_scheduler_settings entityId must match the authenticated workspaceId",
      };
    }

    const mutation = await applyWorkspaceSchedulerSettingsSnapshotInExecutor(
      executor,
      workspaceId,
      toWorkspaceSchedulerSettingsSnapshotInput(operation.payload),
      toWorkspaceSchedulerSettingsMutationMetadata({
        clientUpdatedAt: operation.clientUpdatedAt,
        lastModifiedByReplicaId: replicaId,
        lastOperationId: operation.operationId,
      }),
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = mutation.changeId;
  } else {
    if (operation.entityId !== operation.payload.reviewEventId) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event entityId must match payload.reviewEventId",
      };
    }

    const normalizedClientUpdatedAt = normalizeIsoTimestamp(operation.clientUpdatedAt, "clientUpdatedAt");
    const normalizedReviewedAtClient = normalizeIsoTimestamp(operation.payload.reviewedAtClient, "reviewedAtClient");
    if (normalizedClientUpdatedAt !== normalizedReviewedAtClient) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event clientUpdatedAt must match reviewedAtClient",
      };
    }

    const cardExistsResult = await executor.query<Readonly<{ card_id: string }>>(
      [
        "SELECT card_id",
        "FROM content.cards",
        "WHERE workspace_id = $1 AND card_id = $2",
        "LIMIT 1",
      ].join(" "),
      [workspaceId, operation.payload.cardId],
    );
    if (cardExistsResult.rows[0] === undefined) {
      return {
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "rejected",
        resultingHotChangeId: null,
        error: "review_event payload.cardId must reference an existing card",
      };
    }

    const mutation = await appendReviewEventSnapshotInExecutor(
      executor,
      workspaceId,
      {
        reviewEventId: operation.payload.reviewEventId,
        workspaceId,
        cardId: operation.payload.cardId,
        replicaId,
        clientEventId: operation.payload.clientEventId,
        rating: operation.payload.rating,
        reviewedAtClient: normalizedReviewedAtClient,
        reviewedAtServer: new Date().toISOString(),
      },
      operation.operationId,
    );
    status = mutation.applied ? "applied" : "ignored";
    resultingHotChangeId = null;
  }

  await recordAppliedOperation(executor, workspaceId, replicaId, operation, resultingHotChangeId);

  return {
    operationId: operation.operationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status,
    resultingHotChangeId,
    error: null,
  };
}

export async function processSyncPushOperationsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
  operations: ReadonlyArray<SyncPushOperation>,
): Promise<ReadonlyArray<SyncPushOperationResult>> {
  await ensureWorkspaceSyncMetadataInExecutor(executor, workspaceId);
  const existingAppliedOperations = await loadExistingAppliedOperations(
    executor,
    workspaceId,
    replicaId,
    operations.map((operation) => operation.operationId),
  );
  const results: Array<SyncPushOperationResult> = [];

  for (const operation of operations) {
    const existingResultingHotChangeId = existingAppliedOperations.get(operation.operationId);
    if (existingAppliedOperations.has(operation.operationId)) {
      results.push({
        operationId: operation.operationId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "duplicate",
        resultingHotChangeId: existingResultingHotChangeId ?? null,
        error: null,
      });
      continue;
    }

    results.push(await processOperationInExecutor(executor, workspaceId, replicaId, operation));
  }

  return results;
}

export async function processSyncPush(
  workspaceId: string,
  userId: string,
  input: SyncPushInput,
): Promise<SyncPushResult> {
  const replicaId = await ensureWorkspaceReplica({
    workspaceId,
    userId,
    installationId: input.installationId,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
  });

  const operationResults = await transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => processSyncPushOperationsInExecutor(executor, workspaceId, replicaId, input.operations),
  );

  return {
    operations: operationResults,
  };
}
