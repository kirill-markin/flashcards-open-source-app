import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeReadOnly,
} from "../database";
import { HttpError } from "../shared/errors";
import {
  assertMediaBlobMatchesMetadata,
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
export * from "./uploadSessions";

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
): Promise<void> {
  await transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
    await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, input.lastModifiedByReplicaId);
  });
}

export async function loadReusableImageMediaBlobForWorkspace(
  userId: string,
  workspaceId: string,
  input: NormalizedImageMediaAssetInput,
): Promise<MediaBlob | null> {
  const normalizedInput = normalizeMediaAssetSnapshotInput(toMediaAssetSnapshotInputFromNormalizedImage(input));
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
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
