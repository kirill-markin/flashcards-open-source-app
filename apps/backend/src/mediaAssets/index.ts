import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeDeadline,
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import { findSyncConflictWorkspaceIdInExecutor } from "../sync/conflicts/fork";
import {
  fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor,
  finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
  transactionWithDirectMediaBlobWriterApplyDeadline,
  type DirectMediaBlobWriterAttemptExactInput,
  type DirectMediaBlobWriterAttemptFenceStatus,
  type DirectMediaBlobWriterAttemptFinishStatus,
} from "./blobLifecycle";
import {
  assertMediaBlobMatchesMetadata,
  findMediaAssetRowForUpdateInExecutor,
  findMediaBlobRowBySha256InExecutor,
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
  mapMediaAssetWithBlobRow,
  mapMediaBlobRow,
  normalizeMediaAssetSnapshotInput,
  upsertMediaAssetSnapshotInExecutor,
  upsertMediaAssetSnapshotWithBlobNormalizationInExecutor,
} from "./persistence";
import {
  imageJpegCardMediaBlobMimeType,
  imageJpegCardMediaBlobNormalizationVersion,
} from "./types";
import { assertReplicaBelongsToWorkspaceInExecutor } from "./workspaceReplicas";
import type {
  CompleteMediaAssetUploadInput,
  MediaAsset,
  MediaAssetWithBlob,
  MediaBlob,
  MediaAssetMutationMetadata,
  MediaAssetMutationResult,
  MediaAssetRow,
  MediaAssetSnapshotInput,
  MediaAssetImageIngestionMetadataInput,
  NormalizedImageMediaAssetInput,
} from "./types";

export {
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
  mapMediaBlobRow,
  upsertMediaAssetSnapshotInExecutor,
};

type ExistingMediaAssetIntentRow = Readonly<{
  ok: number;
}>;

export async function assertMediaAssetUploadIntentAvailableForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<void> {
  const result = await queryWithWorkspaceScopeReadOnly<ExistingMediaAssetIntentRow>(
    { userId, workspaceId },
    [
      "SELECT 1 AS ok",
      "FROM content.media_assets",
      "WHERE workspace_id = $1",
      "AND media_asset_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  const existingRow = result.rows[0];
  if (existingRow === undefined) {
    return;
  }

  throw new HttpError(
    409,
    [
      "Media asset is already registered; create a new mediaAssetId before requesting another upload session.",
      `workspaceId=${workspaceId}`,
      `mediaAssetId=${mediaAssetId}`,
    ].join(" "),
    "MEDIA_ASSET_ALREADY_REGISTERED",
  );
}

export async function completeMediaAssetUploadForWorkspace(
  userId: string,
  workspaceId: string,
  input: CompleteMediaAssetUploadInput,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const result = await upsertMediaAssetSnapshotInExecutor(
      executor,
      workspaceId,
      {
        mediaAssetId: input.mediaAssetId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        sourceUrl: input.sourceUrl,
        createdAt: input.createdAt,
        deletedAt: null,
      },
      {
        clientUpdatedAt: input.clientUpdatedAt,
        lastModifiedByReplicaId: input.lastModifiedByReplicaId,
        lastOperationId: input.lastOperationId,
      },
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

function toMediaAssetSnapshotInputFromNormalizedImage(
  input: NormalizedImageMediaAssetInput,
): MediaAssetSnapshotInput {
  return {
    mediaAssetId: input.mediaAssetId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    sourceUrl: input.sourceUrl,
    createdAt: input.createdAt,
    deletedAt: null,
  };
}

function toMediaAssetMutationMetadataFromNormalizedImage(
  input: NormalizedImageMediaAssetInput,
): MediaAssetMutationMetadata {
  return {
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
  };
}

export async function assertImageMediaAssetIngestionPreconditionsForWorkspace(
  userId: string,
  workspaceId: string,
  input: MediaAssetImageIngestionMetadataInput,
  deadlineAtMs: number,
): Promise<void> {
  await transactionWithWorkspaceScopeDeadline({ userId, workspaceId }, deadlineAtMs, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
  });
}

export async function loadReusableImageMediaBlobForWorkspace(
  userId: string,
  workspaceId: string,
  input: NormalizedImageMediaAssetInput,
  deadlineAtMs: number,
): Promise<MediaBlob | null> {
  const normalizedInput = normalizeMediaAssetSnapshotInput(toMediaAssetSnapshotInputFromNormalizedImage(input));
  return transactionWithWorkspaceScopeDeadline({ userId, workspaceId }, deadlineAtMs, async (executor) => {
    const row = await findMediaBlobRowBySha256InExecutor(executor, normalizedInput.sha256);
    if (row === null) {
      return null;
    }

    assertMediaBlobMatchesMetadata(row, {
      mimeType: normalizedInput.mimeType,
      sizeBytes: normalizedInput.sizeBytes,
      sha256: normalizedInput.sha256,
    });
    return mapMediaBlobRow(row);
  });
}

export async function createImageNormalizedMediaAssetForWorkspace(
  userId: string,
  workspaceId: string,
  input: NormalizedImageMediaAssetInput,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
    const result = await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
      executor,
      workspaceId,
      toMediaAssetSnapshotInputFromNormalizedImage(input),
      toMediaAssetMutationMetadataFromNormalizedImage(input),
      imageJpegCardMediaBlobNormalizationVersion,
    );

    return {
      mediaAsset: result.mediaAsset,
      applied: result.applied,
    };
  });
}

type DirectWriterApplyStatus =
  | DirectMediaBlobWriterAttemptFenceStatus
  | DirectMediaBlobWriterAttemptFinishStatus;

async function loadReplayedImageNormalizedMediaAssetInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: NormalizedImageMediaAssetInput,
  status: "already_applied" | "live_applied" | "referenced" | "peer_conflict",
): Promise<MediaAssetMutationResult> {
  const row = await findMediaAssetRowForUpdateInExecutor(
    executor,
    workspaceId,
    input.mediaAssetId,
  );
  if (row === null) {
    const conflictWorkspaceId = await findSyncConflictWorkspaceIdInExecutor(
      executor,
      { entityType: "media_asset", entityId: input.mediaAssetId },
    );
    if (status !== "peer_conflict" || conflictWorkspaceId === null) {
      throw new MediaBlobWriterFenceError("direct_terminal_asset");
    }
    throw new HttpError(
      409,
      "mediaAssetId conflicts with an existing media asset.",
      "MEDIA_ASSET_ID_CONFLICT",
    );
  }
  if (
    row.sha256 !== input.sha256
    || row.mime_type !== imageJpegCardMediaBlobMimeType
    || Number(row.size_bytes) !== input.sizeBytes
  ) {
    throw new HttpError(
      409,
      "mediaAssetId is already registered with different file metadata.",
      "MEDIA_ASSET_ID_CONFLICT",
    );
  }
  return { mediaAsset: mapMediaAssetRow(row), applied: false };
}

export async function applyImageNormalizedMediaAssetWithDirectWriterForWorkspace(
  userId: string,
  workspaceId: string,
  input: NormalizedImageMediaAssetInput,
  writer: DirectMediaBlobWriterAttemptExactInput,
  operationDeadlineAt: string,
): Promise<MediaAssetMutationResult> {
  if (userId !== writer.userId || workspaceId !== writer.workspaceId) {
    throw new MediaBlobWriterFenceError("direct_apply_scope");
  }
  return transactionWithDirectMediaBlobWriterApplyDeadline(
    writer,
    operationDeadlineAt,
    async (executor, snapshot, exactOperationDeadlineAt) => {
      const fence = await fenceDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
        executor,
        snapshot,
        mediaBlobCleanupDelayMs,
        exactOperationDeadlineAt,
      );
      const terminalReplay = fence === "already_applied" || fence === "live_applied"
        || fence === "referenced" || fence === "peer_conflict";
      if (fence !== "ready" && !terminalReplay) {
        throwDirectWriterAttemptStatus(fence);
      }
      if (terminalReplay) {
        return loadReplayedImageNormalizedMediaAssetInExecutor(
          executor,
          workspaceId,
          input,
          fence,
        );
      }
      const result = await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
        executor,
        workspaceId,
        toMediaAssetSnapshotInputFromNormalizedImage(input),
        toMediaAssetMutationMetadataFromNormalizedImage(input),
        snapshot.normalizationVersion,
      );
      const finish = await finishDirectMediaBlobWriterAttemptApplyWithOwnerInExecutor(
        executor,
        snapshot,
        mediaBlobCleanupDelayMs,
        exactOperationDeadlineAt,
      );
      if (
        finish === "already_applied"
        || finish === "referenced"
        || finish === "peer_conflict"
      ) {
        return loadReplayedImageNormalizedMediaAssetInExecutor(
          executor,
          workspaceId,
          input,
          finish,
        );
      }
      if (finish !== "live_applied") throwDirectWriterAttemptStatus(finish);
      return { mediaAsset: result.mediaAsset, applied: true };
    },
  );
}

function throwDirectWriterAttemptStatus(
  status: DirectWriterApplyStatus,
): never {
  if (status === "cleanup_claimed") throw new MediaBlobLifecycleBusyError();
  if (status === "access_denied") {
    throw new HttpError(
      403, "Workspace access changed during media ingestion.", "WORKSPACE_ACCESS_DENIED",
    );
  }
  if (status === "replica_mismatch") {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
  if (status === "ready") {
    throw new MediaBlobWriterFenceError(`direct_attempt_${status}`);
  }
  throw new HttpError(
    409,
    `Media ingestion conflicts with its current writer state. status=${status}`,
    "MEDIA_ASSET_ID_CONFLICT",
  );
}

export async function replayImageNormalizedMediaAssetForWorkspace(
  userId: string,
  workspaceId: string,
  input: NormalizedImageMediaAssetInput,
  status: "already_applied" | "live_applied" | "referenced" | "peer_conflict",
  requestDeadlineAtMs: number,
): Promise<MediaAssetMutationResult> {
  return transactionWithWorkspaceScopeDeadline(
    { userId, workspaceId },
    requestDeadlineAtMs,
    (executor) => loadReplayedImageNormalizedMediaAssetInExecutor(
      executor,
      workspaceId,
      input,
      status,
    ),
  );
}

export async function loadMediaAssetForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAsset> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "AND media_assets.deleted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Media asset not found.", "MEDIA_ASSET_NOT_FOUND");
  }

  return mapMediaAssetRow(row);
}

export async function loadMediaAssetWithBlobForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAssetWithBlob> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "AND media_assets.deleted_at IS NULL",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, mediaAssetId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Media asset not found.", "MEDIA_ASSET_NOT_FOUND");
  }

  return mapMediaAssetWithBlobRow(row);
}
