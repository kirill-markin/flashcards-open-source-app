import {
  queryWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../../database";
import { HttpError } from "../../shared/errors";
import {
  findMediaAssetRowForUpdateInExecutor,
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
} from "../persistence";
import type {
  MediaAsset,
  MediaAssetRow,
  MediaAssetUploadSession,
  MediaAssetUploadSessionRow,
} from "../types";
import {
  assertMediaAssetUploadSessionActive,
  createMediaAssetUploadSessionNotFoundError,
  mapMediaAssetUploadSessionRow,
  MEDIA_UPLOAD_SESSION_COLUMNS,
} from "./shared";

export function isMediaAssetUploadSessionExpired(
  session: MediaAssetUploadSession,
): boolean {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

export async function loadMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  const session = await loadMediaAssetUploadSessionForCompletionForWorkspace(
    userId,
    workspaceId,
    sessionId,
  );
  assertMediaAssetUploadSessionActive(session);
  return session;
}

export async function loadMediaAssetUploadSessionForCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetUploadSessionRow>(
    { userId, workspaceId },
    [
      "SELECT",
      MEDIA_UPLOAD_SESSION_COLUMNS,
      "FROM content.media_upload_sessions",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "LIMIT 1",
    ].join(" "),
    [workspaceId, sessionId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  return mapMediaAssetUploadSessionRow(row);
}

function assertMediaAssetMatchesUploadSessionImmutableBlob(
  mediaAsset: MediaAsset,
  session: MediaAssetUploadSession,
): void {
  if (
    mediaAsset.workspaceId !== session.workspaceId
    || mediaAsset.mediaAssetId !== session.mediaAssetId
    || mediaAsset.mimeType !== session.mimeType
    || mediaAsset.sizeBytes !== session.sizeBytes
    || mediaAsset.sha256 !== session.mediaBlobSha256
  ) {
    throw new HttpError(
      409,
      `Completed media asset upload session conflicts with current immutable blob identity. sessionId=${session.sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }
}

export async function findMediaAssetFromSessionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  session: MediaAssetUploadSession,
): Promise<MediaAsset> {
  const row = await findMediaAssetRowForUpdateInExecutor(executor, workspaceId, session.mediaAssetId);
  if (row === null) {
    throw new Error(`Completed media asset upload session has no media asset row. sessionId=${session.sessionId}`);
  }

  const mediaAsset = mapMediaAssetRow(row);
  assertMediaAssetMatchesUploadSessionImmutableBlob(mediaAsset, session);
  return mediaAsset;
}

export async function loadMediaAssetForCompletedUploadSessionReplayForWorkspace(
  userId: string,
  session: MediaAssetUploadSession,
): Promise<MediaAsset> {
  const result = await queryWithWorkspaceScopeReadOnly<MediaAssetRow>(
    { userId, workspaceId: session.workspaceId },
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = $2",
      "LIMIT 1",
    ].join(" "),
    [session.workspaceId, session.mediaAssetId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `Completed media asset upload session has no media asset row. sessionId=${session.sessionId}`,
    );
  }
  const mediaAsset = mapMediaAssetRow(row);
  assertMediaAssetMatchesUploadSessionImmutableBlob(mediaAsset, session);
  return mediaAsset;
}
