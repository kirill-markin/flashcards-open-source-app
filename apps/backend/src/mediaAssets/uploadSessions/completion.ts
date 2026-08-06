import { setTimeout as wait } from "node:timers/promises";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { HttpError } from "../../shared/errors";
import {
  assertMediaBlobWriterReservationToken,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
} from "../blobLifecycle";
import { upsertMediaAssetSnapshotWithBlobNormalizationInExecutor } from "../persistence";
import type {
  MediaAssetMutationResult,
  MediaAssetUploadSession,
  MediaAssetUploadSessionCompletionStartResult,
  MediaAssetUploadSessionRow,
} from "../types";
import { mediaBlobNormalizationVersions } from "../types";
import { isValidMediaAssetLastOperationId } from "../lastOperationId";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../workspaceReplicas";
import { findMediaAssetFromSessionInExecutor } from "./reads";
import {
  assertMediaAssetUploadSessionCanComplete,
  assertMediaAssetUploadSessionCompletionPartsMatch,
  assertMediaAssetUploadSessionState,
  createMediaAssetUploadSessionNotFoundError,
  createMediaAssetUploadSessionRestartRequiredError,
  createMultipartAttemptSettlementDeadlineError,
  createMultipartMediaBlobStorageCapability,
  findMediaAssetUploadSessionRowForUpdateInExecutor,
  mapMediaAssetUploadSessionRow,
  maximumMultipartAttemptLeaseDurationMs,
  MEDIA_UPLOAD_SESSION_COLUMNS,
  multipartAttemptAbsoluteLeaseGrantPaddingMs,
  multipartAttemptBeginStatuses,
  multipartAttemptFailureStatuses,
  multipartAttemptFenceStatuses,
  multipartAttemptLeaseExpiryPaddingMs,
  multipartAttemptMinimumSettlementBudgetMs,
  multipartAttemptRevocationStatuses,
  multipartAttemptSettlementPollIntervalMs,
  queryMultipartAttemptStatus,
  requireIsoTimestamp,
  requireMediaBlobNormalizationVersion,
  requireMultipartAttemptStatus,
  snapshotMultipartAttemptExactInput,
  snapshotMultipartAttemptInput,
  toMediaAssetMutationMetadataFromUploadSession,
  toMediaAssetSnapshotInputFromUploadSession,
  toMultipartAttemptParams,
  type MediaAssetUploadSessionCompletionApplyFence,
  type MediaAssetUploadSessionCompletionFailureResolution,
  type MediaAssetUploadSessionCompletionResolutionInput,
  type MediaAssetUploadSessionCompletionResolutionRow,
  type MediaAssetUploadSessionCompletionRevocationInput,
  type MediaAssetUploadSessionCompletionRevocationResolution,
  type MediaAssetUploadSessionCompletionStartTransition,
  type MediaAssetUploadSessionCompletionWithOwnerInput,
  type MediaAssetUploadSessionCompletionWithOwnerRejection,
  type MediaAssetUploadSessionCompletionWithOwnerResult,
  type MediaAssetUploadSessionCompletionWithOwnerRow,
  type MultipartAttemptBeginRow,
  type MultipartCompletionPendingRow,
  type MultipartMediaBlobWriterAttemptBeginStatus,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptFailureStatus,
  type MultipartMediaBlobWriterAttemptFenceStatus,
  type MultipartMediaBlobWriterAttemptInput,
  type MultipartMediaBlobWriterAttemptResult,
  type MultipartMediaBlobWriterAttemptRevocationStatus,
} from "./shared";

export async function beginMediaAssetUploadSessionCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionStartResult> {
  const transition = await transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) =>
      beginMediaAssetUploadSessionCompletionInExecutor(
        executor,
        workspaceId,
        sessionId,
        parts,
      ),
  );
  if (transition.status === "legacy_operation_id_restart_required") {
    throw createMediaAssetUploadSessionRestartRequiredError(
      transition.sessionId,
    );
  }
  return transition;
}

export async function beginMediaAssetUploadSessionCompletionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionStartTransition> {
  const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
  if (row === null) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  if (session.state === "completed") {
    return {
      status: "already_completed",
      mediaAsset: await findMediaAssetFromSessionInExecutor(executor, workspaceId, session),
      applied: false,
    };
  }

  assertMediaAssetUploadSessionCanComplete(session);
  if (isValidMediaAssetLastOperationId(session.lastOperationId) === false) {
    if (session.state === "completing") {
      const result = await executor.query<Readonly<{ state: string }>>(
        `UPDATE content.media_upload_sessions
         SET state = 'active'
         WHERE workspace_id = $1
           AND media_upload_session_id = $2
           AND state = 'completing'
         RETURNING state`,
        [workspaceId, sessionId],
      );
      if (result.rows[0]?.state !== "active") {
        throw new Error(
          `Legacy media asset upload session recovery did not return an active row. sessionId=${sessionId}`,
        );
      }
    }
    return {
      status: "legacy_operation_id_restart_required",
      sessionId,
    };
  }
  assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
  if (session.state === "completing") {
    return {
      status: "complete_required",
      uploadSession: session,
    };
  }

  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "UPDATE content.media_upload_sessions",
      "SET state = 'completing'",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "AND state = 'active'",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [workspaceId, sessionId],
  );
  const updatedRow = result.rows[0];
  if (updatedRow === undefined) {
    throw new Error(`Media asset upload session completing update did not return a row. sessionId=${sessionId}`);
  }

  return {
    status: "complete_required",
    uploadSession: mapMediaAssetUploadSessionRow(updatedRow),
  };
}

export async function recoverMediaAssetUploadSessionCompletionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    recoverMediaAssetUploadSessionCompletionInExecutor(executor, workspaceId, sessionId));
}

export async function recoverMediaAssetUploadSessionCompletionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  sessionId: string,
): Promise<MediaAssetUploadSession> {
  const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(executor, workspaceId, sessionId);
  if (row === null) {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }

  const session = mapMediaAssetUploadSessionRow(row);
  if (session.state === "active" || session.state === "completed") {
    return session;
  }

  assertMediaAssetUploadSessionState(session, "completing");
  const result = await executor.query<MediaAssetUploadSessionRow>(
    [
      "UPDATE content.media_upload_sessions",
      "SET state = 'active'",
      "WHERE workspace_id = $1",
      "AND media_upload_session_id = $2",
      "AND state = 'completing'",
      "RETURNING",
      MEDIA_UPLOAD_SESSION_COLUMNS,
    ].join(" "),
    [workspaceId, sessionId],
  );

  const updatedRow = result.rows[0];
  if (updatedRow === undefined) {
    throw new Error(`Media asset upload session completion recovery did not return a row. sessionId=${sessionId}`);
  }

  return mapMediaAssetUploadSessionRow(updatedRow);
}

export async function completeMediaAssetUploadSessionForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  writer: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MediaAssetMutationResult> {
  if (
    userId !== writer.userId
    || workspaceId !== writer.workspaceId
    || sessionId !== writer.sessionId
  ) {
    throw new MediaBlobWriterFenceError("multipart_apply_scope");
  }
  const exactWriter = snapshotMultipartAttemptExactInput(writer);
  const outcome = await transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      const fence =
        await fenceMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
          executor,
          exactWriter,
        );
      if (fence === "peer_conflict") return fence;
      if (
        fence === "already_applied"
        || fence === "live_applied"
        || fence === "referenced"
      ) {
        const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(
          executor,
          workspaceId,
          sessionId,
        );
        if (row === null) {
          throw new MediaBlobWriterFenceError(
            "multipart_terminal_session",
          );
        }
        const session = mapMediaAssetUploadSessionRow(row);
        return {
          mediaAsset: await findMediaAssetFromSessionInExecutor(
            executor,
            workspaceId,
            session,
          ),
          applied: false,
        };
      }
      if (fence !== "ready") {
        throwMultipartAttemptStatus(fence, null);
      }

      const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(
        executor,
        workspaceId,
        sessionId,
      );
      if (row === null) {
        throw createMediaAssetUploadSessionNotFoundError(sessionId);
      }

      const session = mapMediaAssetUploadSessionRow(row);
      assertMediaAssetUploadSessionState(session, "completing");
      await assertReplicaBelongsToWorkspaceInExecutor(
        executor,
        workspaceId,
        session.lastModifiedByReplicaId,
      );
      const result =
        await upsertMediaAssetSnapshotWithBlobNormalizationInExecutor(
          executor,
          workspaceId,
          toMediaAssetSnapshotInputFromUploadSession(session),
          toMediaAssetMutationMetadataFromUploadSession(session),
          exactWriter.normalizationVersion,
        );
      const finish =
        await finishMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
          executor,
          exactWriter,
        );
      if (finish === "peer_conflict") return finish;
      if (
        finish === "already_applied"
        || finish === "referenced"
      ) {
        return {
          mediaAsset: await findMediaAssetFromSessionInExecutor(
            executor,
            workspaceId,
            session,
          ),
          applied: false,
        };
      }
      if (finish !== "live_applied") {
        throwMultipartAttemptStatus(finish, null);
      }

      return {
        mediaAsset: result.mediaAsset,
        applied: true,
      };
    },
  );
  if (outcome === "peer_conflict") {
    throw new HttpError(
      409,
      `Media asset upload session conflicts with newer media asset state. sessionId=${sessionId}`,
      "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
    );
  }
  return outcome;
}

async function checkMediaAssetUploadSessionCompletionPendingInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  sessionId: string,
  mediaAssetId: string,
): Promise<boolean> {
  const result = await executor.query<MultipartCompletionPendingRow>(
    `SELECT content.check_media_upload_session_completion_pending_with_owner(
       $1, $2, $3, $4
     ) AS completion_status`,
    [userId, workspaceId, sessionId, mediaAssetId],
  );
  const status = result.rows[0]?.completion_status;
  if (status === "pending") return true;
  if (status === "not_pending") return false;
  if (status === "access_denied") {
    throwMultipartAttemptStatus("access_denied", null);
  }
  if (status === "session_not_found") {
    throw createMediaAssetUploadSessionNotFoundError(sessionId);
  }
  throw new TypeError(
    `PostgreSQL returned an invalid upload-session completion pending status. status=${String(status)}`,
  );
}

export async function checkMediaAssetUploadSessionCompletionPendingForWorkspace(
  userId: string,
  workspaceId: string,
  sessionId: string,
  mediaAssetId: string,
): Promise<boolean> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    (executor) => checkMediaAssetUploadSessionCompletionPendingInExecutor(
      executor,
      userId,
      workspaceId,
      sessionId,
      mediaAssetId,
    ),
  );
}

export async function checkMediaAssetCompletionPendingForWorkspace(
  userId: string,
  workspaceId: string,
  mediaAssetId: string,
): Promise<boolean> {
  return transactionWithWorkspaceScope(
    { userId, workspaceId },
    async (executor) => {
      const result = await executor.query<MultipartCompletionPendingRow>(
        `SELECT content.check_media_asset_completion_pending_with_owner(
           $1, $2, $3
         ) AS completion_status`,
        [userId, workspaceId, mediaAssetId],
      );
      const status = result.rows[0]?.completion_status;
      if (status === "pending") return true;
      if (status === "not_pending") return false;
      if (status === "access_denied") {
        throwMultipartAttemptStatus("access_denied", null);
      }
      throw new TypeError(
        `PostgreSQL returned an invalid media-asset completion pending status. status=${String(status)}`,
      );
    },
  );
}

export async function beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
): Promise<MediaAssetUploadSessionCompletionWithOwnerResult> {
  const result = await executor.query<MediaAssetUploadSessionCompletionWithOwnerRow>(
    `SELECT completion_status, reservation_token, reservation_state, normalization_version
     FROM content.begin_media_upload_session_completion_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     )`,
    [
      input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
      input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
      input.stagingStorageKey, input.blobStorageKey, input.s3UploadId, input.mimeType,
      input.sizeBytes, input.partSizeBytes, input.partCount, input.sourceUrl,
      input.assetCreatedAt, input.clientUpdatedAt, input.expiresAt,
      input.normalizationVersion,
    ],
  );
  const row = result.rows[0];
  if (
    row?.completion_status === "started" || row?.completion_status === "replayed"
    || row?.completion_status === "already_completed"
  ) {
    const normalizationVersion = mediaBlobNormalizationVersions.find(
      (candidate) => candidate === row.normalization_version,
    );
    if (row.reservation_token === null || normalizationVersion === undefined
      || (row.reservation_state !== "active" && row.reservation_state !== "ambiguous"
        && row.reservation_state !== "finalized")
    ) throw new TypeError("PostgreSQL returned an invalid atomic multipart completion start.");
    assertMediaBlobWriterReservationToken(row.reservation_token);
    return {
      status: row.completion_status,
      reservation: {
        reservationToken: row.reservation_token,
        state: row.reservation_state,
        normalizationVersion,
      },
    };
  }
  const rejectionStatuses: ReadonlyArray<MediaAssetUploadSessionCompletionWithOwnerRejection> = [
    "access_denied", "session_not_found", "payload_mismatch", "replica_mismatch",
    "expired", "aborting", "aborted", "state_conflict", "legacy_unbound",
    "ownership_mismatch", "writer_conflict", "cleanup_claimed", "completed_mismatch",
  ];
  const rejection = rejectionStatuses.find(
    (candidate) => candidate === row?.completion_status,
  );
  if (rejection !== undefined && row?.reservation_token === null
    && row.reservation_state === null) return { status: rejection };
  throw new TypeError("PostgreSQL returned an invalid atomic multipart completion rejection.");
}

export async function beginMediaAssetUploadSessionCompletionWithOwner(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
): Promise<MediaAssetUploadSessionCompletionWithOwnerResult> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(executor, input),
  );
}

export async function beginMediaAssetUploadSessionCompletionWithOwnerAndParts(
  input: MediaAssetUploadSessionCompletionWithOwnerInput,
  parts: ReadonlyArray<Readonly<{ partNumber: number }>>,
): Promise<MediaAssetUploadSessionCompletionWithOwnerResult> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    async (executor) => {
      const row = await findMediaAssetUploadSessionRowForUpdateInExecutor(
        executor,
        input.workspaceId,
        input.sessionId,
      );
      if (row === null) {
        return { status: "session_not_found" };
      }
      const session = mapMediaAssetUploadSessionRow(row);
      if (session.state === "active") {
        const expiryResult = await executor.query<Readonly<{ value: boolean }>>(
          "SELECT $1::timestamptz <= clock_timestamp() AS value",
          [session.expiresAt],
        );
        const expired = expiryResult.rows[0]?.value;
        if (typeof expired !== "boolean") {
          throw new TypeError(
            "PostgreSQL did not return multipart completion expiry state.",
          );
        }
        if (expired) {
          return beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(
            executor,
            input,
          );
        }
      }
      if (session.state === "active" || session.state === "completing") {
        assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
      }
      return beginMediaAssetUploadSessionCompletionWithOwnerInExecutor(
        executor,
        input,
      );
    },
  );
}

function mapMultipartAttemptBeginRow(
  row: MultipartAttemptBeginRow,
  snapshot: MultipartMediaBlobWriterAttemptInput,
): MultipartMediaBlobWriterAttemptResult {
  if (
    row.attempt_status === "acquired"
    || row.attempt_status === "replayed"
    || row.attempt_status === "expired_takeover"
  ) {
    if (
      row.reservation_token === null
      || row.normalization_version === null
      || row.lease_expires_at === null
    ) {
      throw new TypeError(
        "PostgreSQL returned an incomplete multipart writer attempt acquisition.",
      );
    }
    assertMediaBlobWriterReservationToken(row.reservation_token);
    const normalizationVersion = requireMediaBlobNormalizationVersion(
      row.normalization_version,
    );
    const leaseExpiresAt = requireIsoTimestamp(
      row.lease_expires_at,
      "leaseExpiresAt",
    );
    if (Date.parse(leaseExpiresAt) <= Date.now()) {
      throw new TypeError(
        "PostgreSQL returned an expired multipart writer lease.",
      );
    }
    const exactWriter = snapshotMultipartAttemptExactInput({
      ...snapshot,
      reservationToken: row.reservation_token,
      normalizationVersion,
    });
    return {
      status: row.attempt_status,
      reservationToken: row.reservation_token,
      normalizationVersion,
      leaseExpiresAt,
      storageCapability: createMultipartMediaBlobStorageCapability(
        exactWriter,
        leaseExpiresAt,
      ),
    };
  }
  const status = requireMultipartAttemptStatus(
    row.attempt_status,
    multipartAttemptBeginStatuses,
    "begin_multipart_writer_attempt",
  );
  if (row.reservation_token !== null) {
    throw new TypeError(
      "PostgreSQL returned an invalid multipart writer attempt rejection.",
    );
  }
  if (status === "cleanup_claimed") {
    if (
      row.normalization_version === null
      || row.lease_expires_at !== null
    ) {
      throw new TypeError(
        "PostgreSQL returned an invalid cleanup-claimed multipart writer result.",
      );
    }
    requireMediaBlobNormalizationVersion(row.normalization_version);
    return { status };
  }
  if (row.normalization_version !== null) {
    throw new TypeError(
      "PostgreSQL returned an unexpected multipart writer normalization version.",
    );
  }
  if (status === "busy") {
    if (row.lease_expires_at === null) {
      return { status: "completion_pending" };
    }
    return {
      status,
      leaseExpiresAt: requireIsoTimestamp(
        row.lease_expires_at,
        "leaseExpiresAt",
      ),
    };
  }
  if (row.lease_expires_at !== null) {
    throw new TypeError(
      "PostgreSQL returned an unexpected multipart writer lease.",
    );
  }
  return { status };
}

export async function beginMediaAssetUploadSessionCompletionAttemptWithOwner(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseDurationMs: number,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  if (
    !Number.isSafeInteger(leaseDurationMs)
    || leaseDurationMs < 1
    || leaseDurationMs > maximumMultipartAttemptLeaseDurationMs
  ) {
    throw new RangeError(
      `leaseDurationMs must be an integer between 1 and ${maximumMultipartAttemptLeaseDurationMs}.`,
    );
  }
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    async (executor) => {
      const result = await executor.query<MultipartAttemptBeginRow>(
        `SELECT attempt_status, reservation_token, normalization_version, lease_expires_at
         FROM content.begin_media_upload_session_completion_attempt_with_owner(
           $1,$2,ROW(
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )::content.multipart_media_blob_writer_attempt_payload
         )`,
        [snapshot.attemptToken, leaseDurationMs, ...toMultipartAttemptParams(snapshot)],
      );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid multipart writer attempt row count.",
        );
      }
      return mapMultipartAttemptBeginRow(result.rows[0], snapshot);
    },
  );
}

export async function beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseTargetAtMs: number,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  const nowMs = Date.now();
  if (
    !Number.isSafeInteger(leaseTargetAtMs)
    || leaseTargetAtMs
      <= nowMs + multipartAttemptAbsoluteLeaseGrantPaddingMs
    || leaseTargetAtMs - nowMs > maximumMultipartAttemptLeaseDurationMs
  ) {
    throw new RangeError(
      `leaseTargetAtMs must be more than ${multipartAttemptAbsoluteLeaseGrantPaddingMs}ms and at most ${maximumMultipartAttemptLeaseDurationMs}ms in the future.`,
    );
  }
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    async (executor) => {
      await executor.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             $1 || ':' || $2::TEXT,
             0::BIGINT
           )
         )`,
        [snapshot.userId, snapshot.workspaceId],
      );
      const result = await executor.query<MultipartAttemptBeginRow>(
        `SELECT attempt_status, reservation_token, normalization_version, lease_expires_at
         FROM content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
           $1,
           pg_catalog.to_timestamp($2::BIGINT / 1000.0),
           ROW(
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )::content.multipart_media_blob_writer_attempt_payload
         )`,
        [
          snapshot.attemptToken,
          leaseTargetAtMs - multipartAttemptAbsoluteLeaseGrantPaddingMs,
          ...toMultipartAttemptParams(snapshot),
        ],
      );
      if (result.rows.length === 0) {
        throw createMultipartAttemptSettlementDeadlineError();
      }
      if (result.rows.length !== 1) {
        throw new TypeError(
          "PostgreSQL returned an invalid absolute-target multipart writer attempt row count.",
        );
      }
      return mapMultipartAttemptBeginRow(result.rows[0], snapshot);
    },
  );
}

async function beginMediaAssetUploadSessionCompletionAttemptUntilSettled(
  input: MultipartMediaBlobWriterAttemptInput,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
  beginAttempt: () => Promise<MultipartMediaBlobWriterAttemptResult>,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  signal.throwIfAborted();
  if (
    !Number.isSafeInteger(requestDeadlineAtMs)
    || requestDeadlineAtMs <= Date.now()
  ) {
    throw createMultipartAttemptSettlementDeadlineError();
  }
  for (;;) {
    signal.throwIfAborted();
    if (
      requestDeadlineAtMs - Date.now()
      <= multipartAttemptMinimumSettlementBudgetMs
    ) {
      throw createMultipartAttemptSettlementDeadlineError();
    }
    const result = await beginAttempt();
    if (result.status !== "busy") return result;
    if (
      await checkMediaAssetUploadSessionCompletionPendingForWorkspace(
        snapshot.userId,
        snapshot.workspaceId,
        snapshot.sessionId,
        snapshot.mediaAssetId,
      )
    ) {
      return { status: "completion_pending" };
    }

    const leaseExpiresAtMs = Date.parse(result.leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAtMs)) {
      throw new MediaBlobWriterFenceError(
        "multipart_attempt_busy_lease_expiry",
      );
    }
    const nowMs = Date.now();
    const waitUntilTakeoverMs = Math.max(
      1,
      leaseExpiresAtMs - nowMs + multipartAttemptLeaseExpiryPaddingMs,
    );
    const waitMs = Math.min(
      multipartAttemptSettlementPollIntervalMs,
      waitUntilTakeoverMs,
    );
    if (
      nowMs + waitMs + multipartAttemptMinimumSettlementBudgetMs
      > requestDeadlineAtMs
    ) {
      throw createMultipartAttemptSettlementDeadlineError();
    }
    try {
      await wait(waitMs, undefined, { signal });
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      throw error;
    }
  }
}

export async function beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseDurationMs: number,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  return beginMediaAssetUploadSessionCompletionAttemptUntilSettled(
    snapshot,
    requestDeadlineAtMs,
    signal,
    () => beginMediaAssetUploadSessionCompletionAttemptWithOwner(
      snapshot,
      leaseDurationMs,
    ),
  );
}

export async function beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled(
  input: MultipartMediaBlobWriterAttemptInput,
  leaseTargetAtMs: number,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
): Promise<MultipartMediaBlobWriterAttemptResult> {
  const snapshot = snapshotMultipartAttemptInput(input);
  return beginMediaAssetUploadSessionCompletionAttemptUntilSettled(
    snapshot,
    requestDeadlineAtMs,
    signal,
    () => beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
      snapshot,
      leaseTargetAtMs,
    ),
  );
}

export function fenceMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptFenceStatus> {
  return queryMultipartAttemptStatus(
    executor,
    "fence_media_upload_session_completion_attempt_apply_with_owner",
    input,
    multipartAttemptFenceStatuses,
  );
}

export function finishMediaAssetUploadSessionCompletionAttemptApplyWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptFailureStatus> {
  return queryMultipartAttemptStatus(
    executor,
    "finish_media_upload_session_completion_attempt_apply_with_owner",
    input,
    multipartAttemptFailureStatuses,
  );
}

export function resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptFailureStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return transactionWithWorkspaceScope(
    { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    (executor) => queryMultipartAttemptStatus(
      executor,
      "resolve_media_upload_session_completion_attempt_failure_with_owner",
      snapshot,
      multipartAttemptFailureStatuses,
    ),
  );
}

export function resolveMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
  input: MultipartMediaBlobWriterAttemptExactInput,
): Promise<MultipartMediaBlobWriterAttemptRevocationStatus> {
  const snapshot = snapshotMultipartAttemptExactInput(input);
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(
      executor,
      { userId: snapshot.userId, workspaceId: snapshot.workspaceId },
    );
    return queryMultipartAttemptStatus(
      executor,
      "resolve_media_upload_session_completion_attempt_after_access_revocation",
      snapshot,
      multipartAttemptRevocationStatuses,
    );
  });
}

function throwMultipartAttemptStatus(
  status:
    | MultipartMediaBlobWriterAttemptBeginStatus
    | MultipartMediaBlobWriterAttemptFenceStatus
    | MultipartMediaBlobWriterAttemptFailureStatus
    | MultipartMediaBlobWriterAttemptRevocationStatus,
  leaseExpiresAt: string | null,
): never {
  if (status === "cleanup_claimed") {
    throw new MediaBlobLifecycleBusyError();
  }
  if (status === "access_denied") {
    throw new HttpError(
      403,
      "Workspace access changed during multipart completion.",
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    );
  }
  if (status === "replica_mismatch") {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
  if (status === "busy") {
    const leaseExpiresAtMs = leaseExpiresAt === null
      ? Number.NaN
      : Date.parse(leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAtMs)) {
      throw new TypeError(
        "Multipart writer busy status did not include a valid lease expiry.",
      );
    }
    throw new HttpError(
      409,
      "Multipart completion is already in progress. Retry after the active writer lease expires.",
      "MEDIA_ASSET_WRITER_BUSY",
      {
        retryAfterSeconds: Math.max(
          1,
          Math.min(60, Math.ceil((leaseExpiresAtMs - Date.now()) / 1_000)),
        ),
      },
    );
  }
  if (status === "ready" || status === "access_active") {
    throw new TypeError(
      `Multipart writer returned an impossible terminal status. status=${status}`,
    );
  }
  throw new HttpError(
    409,
    `Multipart completion conflicts with its current writer state. status=${status}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

function toMediaAssetUploadSessionCompletionResolutionParams(
  input: MediaAssetUploadSessionCompletionRevocationInput,
): ReadonlyArray<string | number | null> {
  return [
    input.userId, input.workspaceId, input.sessionId, input.mediaAssetId,
    input.lastModifiedByReplicaId, input.lastOperationId, input.sha256,
    input.stagingStorageKey, input.blobStorageKey, input.s3UploadId, input.mimeType,
    input.sizeBytes, input.partSizeBytes, input.partCount, input.sourceUrl,
    input.assetCreatedAt, input.clientUpdatedAt, input.expiresAt,
  ];
}

export async function fenceMediaAssetUploadSessionCompletionApplyWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionApplyFence> {
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<MediaAssetUploadSessionCompletionResolutionRow>(
    `SELECT content.fence_media_upload_session_completion_apply_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     ) AS resolution_status`,
    [
      ...toMediaAssetUploadSessionCompletionResolutionParams(input),
      input.reservationToken, input.normalizationVersion, mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (status === "ready" || status === "already_applied" || status === "peer_conflict"
    || status === "access_denied" || status === "aborting" || status === "aborted"
    || status === "stale") return status;
  throw new TypeError("PostgreSQL returned an invalid multipart completion apply fence.");
}

export async function fenceMediaAssetUploadSessionCompletionApplyWithOwner(
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionApplyFence> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => fenceMediaAssetUploadSessionCompletionApplyWithOwnerInExecutor(executor, input),
  );
}

export async function resolveMediaAssetUploadSessionCompletionFailureWithOwnerInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionFailureResolution> {
  assertMediaBlobWriterReservationToken(input.reservationToken);
  const result = await executor.query<MediaAssetUploadSessionCompletionResolutionRow>(
    `SELECT content.resolve_media_upload_session_completion_failure_with_owner(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     ) AS resolution_status`,
    [
      ...toMediaAssetUploadSessionCompletionResolutionParams(input),
      input.reservationToken, input.normalizationVersion, mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (status === "referenced" || status === "unreferenced_restored"
    || status === "peer_conflict" || status === "already_closed"
    || status === "access_denied" || status === "stale") return status;
  throw new TypeError("PostgreSQL returned an invalid multipart completion failure resolution.");
}

export async function resolveMediaAssetUploadSessionCompletionFailureWithOwner(
  input: MediaAssetUploadSessionCompletionResolutionInput,
): Promise<MediaAssetUploadSessionCompletionFailureResolution> {
  return transactionWithWorkspaceScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    (executor) => resolveMediaAssetUploadSessionCompletionFailureWithOwnerInExecutor(executor, input),
  );
}

export async function resolveMediaAssetUploadSessionCompletionAfterAccessRevocationInExecutor(
  executor: DatabaseExecutor,
  input: MediaAssetUploadSessionCompletionRevocationInput,
): Promise<MediaAssetUploadSessionCompletionRevocationResolution> {
  const result = await executor.query<MediaAssetUploadSessionCompletionResolutionRow>(
    `SELECT content.resolve_media_upload_session_completion_after_access_revocation(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     ) AS resolution_status`,
    [
      ...toMediaAssetUploadSessionCompletionResolutionParams(input),
      mediaBlobCleanupDelayMs,
    ],
  );
  const status = result.rows[0]?.resolution_status;
  if (status === "referenced" || status === "unreferenced_closed"
    || status === "absent_closed" || status === "peer_conflict"
    || status === "already_closed" || status === "access_active"
    || status === "stale") return status;
  throw new TypeError("PostgreSQL returned an invalid multipart completion revocation resolution.");
}

export async function resolveMediaAssetUploadSessionCompletionAfterAccessRevocation(
  input: MediaAssetUploadSessionCompletionRevocationInput,
): Promise<MediaAssetUploadSessionCompletionRevocationResolution> {
  return unsafeTransaction(
    (executor) => resolveMediaAssetUploadSessionCompletionAfterAccessRevocationInExecutor(
      executor,
      input,
    ),
  );
}
