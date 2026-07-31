import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import {
  assertMediaBlobWriterReservationToken,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
  type MediaBlobWriterReservation,
} from "../blobLifecycle";
import {
  mediaBlobNormalizationVersions,
  passthroughMediaBlobNormalizationVersion,
} from "../types";
import {
  multipartAttemptClosureStatuses,
  multipartAttemptHandoffStatuses,
  queryMultipartAttemptStatus,
  requireMultipartAttemptStatus,
  snapshotMultipartAttemptExactInput,
  toMultipartAttemptParams,
  type MediaAssetUploadSessionCurrentWriterClosure,
  type MediaAssetUploadSessionWriterClosure,
  type MediaAssetUploadSessionWriterClosureInput,
  type MediaAssetUploadSessionWriterClosureRow,
  type MultipartAttemptStatusRow,
  type MultipartMediaBlobWriterAttemptClosureStatus,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptHandoffStatus,
  type OwnedMultipartReservationRow,
} from "./shared";

export async function closeMediaAssetUploadSessionBlobWriterInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionWriterClosure> {
  const result = await executor.query<MediaAssetUploadSessionWriterClosureRow>(
    `SELECT content.close_media_upload_session_blob_writer(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     ) AS closure_status`,
    [
      input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
      input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
      input.storageKey, input.mimeType, input.sizeBytes, input.expiresAt,
      mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.closure_status;
  if (
    status === "absent" || status === "referenced" || status === "unreferenced"
    || status === "no_writer_closed"
    || status === "access_active" || status === "already_closed" || status === "stale"
  ) return status;
  throw new TypeError("PostgreSQL returned an invalid media upload session writer closure.");
}

export async function closeMediaAssetUploadSessionBlobWriter(
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionWriterClosure> {
  return unsafeTransaction(
    (executor) => closeMediaAssetUploadSessionBlobWriterInExecutor(executor, input),
  );
}

export async function closeMediaAssetUploadSessionCurrentBlobWriterInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionCurrentWriterClosure> {
  const result = await executor.query<MediaAssetUploadSessionWriterClosureRow>(
    `SELECT content.close_media_upload_session_current_blob_writer_with_owner(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     ) AS closure_status`,
    [
      input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
      input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
      input.storageKey, input.mimeType, input.sizeBytes, input.expiresAt,
      mediaBlobCleanupDelayMs,
    ],
  );
  const statuses: ReadonlyArray<MediaAssetUploadSessionCurrentWriterClosure> = [
    "absent", "referenced", "unreferenced", "no_writer_closed",
    "access_active", "already_closed", "stale", "access_denied",
    "replica_mismatch", "ownership_mismatch", "writer_conflict",
    "cleanup_claimed", "busy", "already_applied", "live_applied",
    "peer_conflict", "unreferenced_restored", "aborted", "stale_attempt",
  ];
  const status = statuses.find(
    (candidate) => candidate === result.rows[0]?.closure_status,
  );
  if (status === undefined) {
    throw new TypeError(
      "PostgreSQL returned an invalid current media upload session writer closure.",
    );
  }
  return status;
}

export function closeMediaAssetUploadSessionCurrentBlobWriter(
  input: MediaAssetUploadSessionWriterClosureInput,
): Promise<MediaAssetUploadSessionCurrentWriterClosure> {
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: input.userId, workspaceId: input.workspaceId },
    );
    return closeMediaAssetUploadSessionCurrentBlobWriterInExecutor(
      executor,
      input,
    );
  });
}

export function closeMediaAssetUploadSessionBlobWriterAttempt(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptClosureStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    );
    return queryMultipartAttemptStatus(
      executor,
      "close_media_upload_session_blob_writer_attempts",
      snapshot,
      multipartAttemptClosureStatuses,
    );
  });
}

export function handoffMediaAssetUploadSessionCompletionAttempt(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptHandoffStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    async (executor) => {
      const result = await executor.query<MultipartAttemptStatusRow>(
        `SELECT content.handoff_media_upload_session_completion_attempt(
           $1,$2,ROW(
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )::content.multipart_media_blob_writer_attempt_payload
         ) AS attempt_status`,
        [
          snapshot.attemptToken,
          snapshot.reservationToken,
          ...toMultipartAttemptParams(snapshot),
        ],
      );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart handoff row count.",
        );
      }
      return requireMultipartAttemptStatus(
        result.rows[0]?.attempt_status,
        multipartAttemptHandoffStatuses,
        "handoff_media_upload_session_completion_attempt",
      );
    },
  );
}

export function handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptHandoffStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return unsafeTransaction(async (executor) => {
    const result = await executor.query<MultipartAttemptStatusRow>(
      `SELECT content.handoff_media_upload_session_completion_attempt_after_access_revocation(
         $1,$2,ROW(
           $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
         )::content.multipart_media_blob_writer_attempt_payload
       ) AS attempt_status`,
      [
        snapshot.attemptToken,
        snapshot.reservationToken,
        ...toMultipartAttemptParams(snapshot),
      ],
    );
    if (result.rows.length !== 1) {
      throw new TypeError(
        "PostgreSQL returned an invalid access-revoked multipart handoff row count.",
      );
    }
    return requireMultipartAttemptStatus(
      result.rows[0]?.attempt_status,
      multipartAttemptHandoffStatuses,
      "handoff_media_upload_session_completion_attempt_after_access_revocation",
    );
  });
}

export async function reserveMediaAssetUploadSessionBlobWriterWithOwner(
  userId: string, workspaceId: string, sessionId: string,
): Promise<MediaBlobWriterReservation> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const result = await executor.query<OwnedMultipartReservationRow>(
      `SELECT reservation_token, reservation_state, reservation_status, normalization_version FROM content.reserve_media_upload_session_blob_writer_with_owner($1,$2,$3,$4)`,
      [userId, workspaceId, sessionId, passthroughMediaBlobNormalizationVersion],
    );
    const row = result.rows[0];
    if (row?.reservation_status === "cleanup_claimed") throw new MediaBlobLifecycleBusyError();
    const normalizationVersion = mediaBlobNormalizationVersions.find(
      (candidate) => candidate === row?.normalization_version,
    );
    if (row?.reservation_status !== "reserved" || row.reservation_token === null
      || (row.reservation_state !== "active" && row.reservation_state !== "ambiguous"
        && row.reservation_state !== "finalized") || normalizationVersion === undefined
    ) throw new MediaBlobWriterFenceError("reserve_multipart_owner");
    assertMediaBlobWriterReservationToken(row.reservation_token);
    return { reservationToken: row.reservation_token, state: row.reservation_state,
      normalizationVersion };
  });
}
