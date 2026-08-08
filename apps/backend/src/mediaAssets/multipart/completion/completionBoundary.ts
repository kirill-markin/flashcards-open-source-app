import {
  captureBackendWarning,
  type BackendObservationScope,
} from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
} from "../../../server/mediaRequests/multipartCompletionRequestTiming";
import {
  MediaBlobLifecycleBusyError,
} from "../../blobLifecycle";
import { isValidMediaAssetLastOperationId } from "../../lastOperationId";
import {
  abortMultipartMediaAssetUpload,
  completeMultipartMediaAssetUpload,
} from "../../storage";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAssetUploadSession,
} from "../../types";
import {
  assertMediaAssetUploadSessionCompletionPartsMatch,
  assertMediaAssetUploadSessionSupportsDurableCompletion,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  closeMediaAssetUploadSessionCurrentBlobWriter,
  completeMediaAssetUploadSessionForWorkspace,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  isMediaAssetUploadSessionExpired,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MediaAssetUploadSessionAbortStartWithWriterResult,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptHandoffStatus,
  type MultipartMediaBlobWriterAttemptInput,
} from "../../uploadSessions";
import {
  createMultipartCompletionHandedOffError,
  createMultipartCompletionInProgressError,
  createMultipartDatabaseCommitReplay,
  createUploadSessionExpiredError,
  multipartWriterHeartbeatIntervalMs,
  multipartWriterLeaseExpiryObservationPaddingMs,
  multipartWriterLeaseStorageAbortHeadroomMs,
  toMultipartAttemptInput,
  type MultipartCompletionRequestDeadline,
  type MultipartDatabaseCommitReplay,
} from "../requestBoundary";
import {
  createMultipartAttemptError,
  createMultipartCompletionResolutionError,
  createMultipartWriterHeartbeat,
  isExpiredMultipartCompletionCleanupRequired,
  isMultipartAppliedStatus,
  isMultipartCompletionDeadlineFailure,
  mapMultipartCompletionDeadlineError,
  MultipartWriterLeaseRenewalRejectedError,
  parseMultipartWriterLeaseExpiresAtMs,
  renewMultipartWriterLease,
  replayCompletedMultipartResult,
  resolveMultipartAttemptFailure,
  resolveMultipartOperationExactlyUntilSafe,
  type MultipartExactResolutionResult,
  type MultipartWriterHeartbeat,
  type MultipartWriterLease,
} from "../writerLifecycle/writerLease";

export async function beginUploadSessionAbort(
  userId: string,
  workspaceId: string,
  sessionId: string,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
): Promise<MediaAssetUploadSessionAbortStartWithWriterResult> {
  return replayDatabaseCommit(
    () => beginMediaAssetUploadSessionAbortForWorkspace(
      userId,
      workspaceId,
      sessionId,
    ),
  );
}

export async function abortMultipartUploadSessionAtApplicationBoundary(
  userId: string,
  abortStart: MediaAssetUploadSessionAbortStartWithWriterResult,
  observationScope: BackendObservationScope,
  signal: AbortSignal,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  abortMultipartMediaAssetUploadFn: typeof abortMultipartMediaAssetUpload,
): Promise<MediaAssetUploadSession> {
  if (abortStart.status === "already_aborted") {
    return abortStart.uploadSession;
  }
  if (abortStart.status === "completion_in_progress") {
    throw createMultipartCompletionInProgressError(
      503,
      "Multipart completion has a live foreground writer. Retry abort after the Retry-After delay; no upload state was changed.",
      1,
    );
  }
  if (abortStart.status === "completion_pending") {
    throw createMultipartCompletionInProgressError(
      409,
      "Multipart completion is being durably reconciled. Retry abort after completion settles; no upload state was changed.",
      1,
    );
  }
  const session = abortStart.uploadSession;
  await abortMultipartMediaAssetUploadFn({
    signal,
    workspaceId: session.workspaceId,
    mediaAssetId: session.mediaAssetId,
    stagingStorageKey: session.stagingStorageKey,
    s3UploadId: session.s3UploadId,
    observationScope,
  });
  const closure = await replayDatabaseCommit(
    () => closeMediaAssetUploadSessionCurrentBlobWriter({
      userId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      mediaAssetId: session.mediaAssetId,
      lastModifiedByReplicaId: session.lastModifiedByReplicaId,
      lastOperationId: session.lastOperationId,
      sha256: session.mediaBlobSha256,
      storageKey: session.blobStorageKey,
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      expiresAt: session.expiresAt,
    }),
  );
  if (closure === "cleanup_claimed") {
    throw new MediaBlobLifecycleBusyError();
  }
  const closedSession = await replayDatabaseCommit(
    () => loadMediaAssetUploadSessionForCompletionForWorkspace(
      userId,
      session.workspaceId,
      session.sessionId,
    ),
  );
  if (closedSession.state === "aborted") return closedSession;
  if (closedSession.state === "completed") {
    throw new HttpError(
      409,
      `Media asset upload session completed while aborting. sessionId=${session.sessionId} closure=${closure}`,
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    );
  }
  throw new HttpError(
    409,
    `Multipart abort conflicts with its current writer state. status=${closure}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

export type MultipartCompletionApplicationDependencies = Readonly<{
  abortMultipartMediaAssetUploadFn: typeof abortMultipartMediaAssetUpload;
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled;
  completeMultipartMediaAssetUploadFn:
    typeof completeMultipartMediaAssetUpload;
  completeMediaAssetUploadSessionForWorkspaceFn:
    typeof completeMediaAssetUploadSessionForWorkspace;
  handoffCompletionAttemptAfterAccessRevocationFn:
    typeof handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation;
  loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn:
    typeof loadMediaAssetForCompletedUploadSessionReplayForWorkspace;
  resolveCompletionAttemptFailureWithOwnerFn:
    typeof resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner;
}>;

export const multipartCompletionApplicationDependencies:
MultipartCompletionApplicationDependencies = Object.freeze({
  abortMultipartMediaAssetUploadFn: abortMultipartMediaAssetUpload,
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  completeMultipartMediaAssetUploadFn: completeMultipartMediaAssetUpload,
  completeMediaAssetUploadSessionForWorkspaceFn:
    completeMediaAssetUploadSessionForWorkspace,
  handoffCompletionAttemptAfterAccessRevocationFn:
    handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn:
    loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  resolveCompletionAttemptFailureWithOwnerFn:
    resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
});

type MultipartCompletionApplicationResult = Awaited<
  ReturnType<typeof completeMediaAssetUploadSessionForWorkspace>
>;

function isMultipartHandoffAppliedStatus(
  status: MultipartMediaBlobWriterAttemptHandoffStatus,
): boolean {
  return status === "already_applied"
    || status === "live_applied"
    || status === "referenced";
}

function createMultipartCompletionSafeLeaseExpiryError(
  completionError: unknown,
  resolutionError: unknown,
): Error {
  const diagnosticCause = new AggregateError(
    [completionError, resolutionError],
    "Multipart completion failed and exact resolution remained unavailable until the confirmed writer lease expired safely.",
  );
  if (completionError instanceof HttpError) {
    const preservedError = new HttpError(
      completionError.statusCode,
      completionError.message,
      completionError.code ?? undefined,
      completionError.details ?? undefined,
    );
    Object.defineProperty(preservedError, "cause", {
      value: diagnosticCause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return preservedError;
  }
  return diagnosticCause;
}

async function handoffAcceptedMultipartAttempt(
  completionError: unknown,
  userId: string,
  session: MediaAssetUploadSession,
  writer: MultipartMediaBlobWriterAttemptExactInput,
  lastConfirmedLeaseExpiresAtMs: number,
  observationScope: BackendObservationScope,
  requestDeadline: MultipartCompletionRequestDeadline,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  dependencies: MultipartCompletionApplicationDependencies,
): Promise<MultipartCompletionApplicationResult> {
  let resolution:
    MultipartExactResolutionResult<MultipartMediaBlobWriterAttemptHandoffStatus>;
  try {
    resolution = await resolveMultipartOperationExactlyUntilSafe(
      () =>
        dependencies.handoffCompletionAttemptAfterAccessRevocationFn(
          writer,
        ),
      lastConfirmedLeaseExpiresAtMs,
      requestDeadline,
      observationScope,
    );
  } catch (handoffError) {
    throw createMultipartCompletionResolutionError(
      completionError,
      mapMultipartCompletionDeadlineError(
        handoffError,
        requestDeadline,
        requestDeadline,
      ),
    );
  }

  if (resolution.kind === "safe_lease_expired") {
    if (resolution.resolutionError === null) throw completionError;
    throw createMultipartCompletionSafeLeaseExpiryError(
      completionError,
      resolution.resolutionError,
    );
  }
  const handoffStatus = resolution.value;
  if (
    handoffStatus === "handed_off"
    || handoffStatus === "already_pending"
  ) {
    throw createMultipartCompletionHandedOffError();
  }
  if (isMultipartHandoffAppliedStatus(handoffStatus)) {
    return replayCompletedMultipartResult(
      userId,
      session,
      replayDatabaseCommit,
      dependencies
        .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
    );
  }
  if (
    handoffStatus !== "failed"
  ) {
    throw createMultipartAttemptError(
      handoffStatus,
      null,
    );
  }
  throw createMultipartAttemptError("stale_attempt", null);
}

async function resolveRecoveredMultipartAttempt(
  completionError: unknown,
  userId: string,
  session: MediaAssetUploadSession,
  attemptInput: MultipartMediaBlobWriterAttemptInput,
  writerLeaseTargetAtMs: number,
  observationScope: BackendObservationScope,
  requestDeadline: MultipartCompletionRequestDeadline,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  dependencies: MultipartCompletionApplicationDependencies,
): Promise<MultipartCompletionApplicationResult> {
  let recovery:
    MultipartExactResolutionResult<Awaited<
    ReturnType<
      typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled
    >
    >>;
  try {
    recovery = await resolveMultipartOperationExactlyUntilSafe(
      () =>
        dependencies.beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn(
          attemptInput,
          writerLeaseTargetAtMs,
          writerLeaseTargetAtMs,
          requestDeadline.signal,
        ),
      writerLeaseTargetAtMs - 1,
      requestDeadline,
      observationScope,
    );
  } catch (resolutionError) {
    throw createMultipartCompletionResolutionError(
      completionError,
      mapMultipartCompletionDeadlineError(
        resolutionError,
        requestDeadline,
        requestDeadline,
      ),
    );
  }
  if (recovery.kind === "safe_lease_expired") {
    if (recovery.resolutionError === null) throw completionError;
    throw createMultipartCompletionSafeLeaseExpiryError(
      completionError,
      recovery.resolutionError,
    );
  }
  const recoveredAttempt = recovery.value;

  if (!("reservationToken" in recoveredAttempt)) {
    if (recoveredAttempt.status === "completion_pending") {
      throw createMultipartCompletionHandedOffError();
    }
    if (isMultipartAppliedStatus(recoveredAttempt.status)) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    throw completionError;
  }

  const writer: MultipartMediaBlobWriterAttemptExactInput = {
    ...attemptInput,
    reservationToken: recoveredAttempt.reservationToken,
    normalizationVersion: recoveredAttempt.normalizationVersion,
  };
  return handoffAcceptedMultipartAttempt(
    completionError,
    userId,
    session,
    writer,
    parseMultipartWriterLeaseExpiresAtMs(recoveredAttempt.leaseExpiresAt),
    observationScope,
    requestDeadline,
    replayDatabaseCommit,
    dependencies,
  );
}

export async function completeMultipartUploadSessionAtApplicationBoundary(
  userId: string,
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>,
  attemptToken: string,
  observationScope: BackendObservationScope,
  operationDeadline: MultipartCompletionRequestDeadline,
  writerLeaseTargetAtMs: number,
  requestDeadline: MultipartCompletionRequestDeadline,
  dependencies: MultipartCompletionApplicationDependencies,
): Promise<MultipartCompletionApplicationResult> {
  if (
    createMultipartCompletionWriterLeaseTargetAtMs(
      operationDeadline.deadlineAtMs,
      requestDeadline.deadlineAtMs,
    ) !== writerLeaseTargetAtMs
    || writerLeaseTargetAtMs - operationDeadline.deadlineAtMs
      <= multipartWriterLeaseStorageAbortHeadroomMs
    || requestDeadline.deadlineAtMs - writerLeaseTargetAtMs
      <= multipartWriterLeaseExpiryObservationPaddingMs
  ) {
    throw new RangeError(
      "Multipart completion writer lease target does not preserve the request timing and storage-safety margins.",
    );
  }
  const replayOperationDatabaseCommit =
    createMultipartDatabaseCommitReplay(operationDeadline);
  const replayResolutionDatabaseCommit =
    createMultipartDatabaseCommitReplay(requestDeadline);

  if (
    session.state === "completed"
    && isValidMediaAssetLastOperationId(session.lastOperationId) === false
  ) {
    return replayCompletedMultipartResult(
      userId,
      session,
      replayResolutionDatabaseCommit,
      dependencies
        .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
    );
  }
  if (
    session.state === "completing"
    && isValidMediaAssetLastOperationId(session.lastOperationId) === false
  ) {
    try {
      const legacyAbort = await beginUploadSessionAbort(
        userId,
        session.workspaceId,
        session.sessionId,
        replayOperationDatabaseCommit,
      );
      await abortMultipartUploadSessionAtApplicationBoundary(
        userId,
        legacyAbort,
        observationScope,
        operationDeadline.signal,
        replayResolutionDatabaseCommit,
        dependencies.abortMultipartMediaAssetUploadFn,
      );
    } catch (error) {
      if (
        !(error instanceof HttpError)
        || error.code !== "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED"
      ) {
        throw error;
      }
      const completedSession = await replayResolutionDatabaseCommit(
        () => loadMediaAssetUploadSessionForCompletionForWorkspace(
          userId,
          session.workspaceId,
          session.sessionId,
        ),
      );
      if (completedSession.state !== "completed") throw error;
      return replayCompletedMultipartResult(
        userId,
        completedSession,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
  }
  if (session.state === "active" || session.state === "completing") {
    assertMediaAssetUploadSessionSupportsDurableCompletion(session);
  }
  if (isExpiredMultipartCompletionCleanupRequired(session)) {
    const expiry = await beginUploadSessionAbort(
      userId,
      session.workspaceId,
      session.sessionId,
      replayOperationDatabaseCommit,
    );
    await abortMultipartUploadSessionAtApplicationBoundary(
      userId,
      expiry,
      observationScope,
      operationDeadline.signal,
      replayResolutionDatabaseCommit,
      dependencies.abortMultipartMediaAssetUploadFn,
    );
    throw createUploadSessionExpiredError(session);
  }
  if (session.state === "active" || session.state === "completing") {
    assertMediaAssetUploadSessionCompletionPartsMatch(session, parts);
  }

  const attemptInput = toMultipartAttemptInput(
    attemptToken,
    userId,
    session,
    parts,
  );
  let attempt: Awaited<
    ReturnType<
      typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled
    >
  >;
  try {
    attempt = await replayOperationDatabaseCommit(
      () =>
        dependencies.beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn(
          attemptInput,
          writerLeaseTargetAtMs,
          operationDeadline.deadlineAtMs,
          operationDeadline.signal,
        ),
    );
  } catch (error) {
    const completionError = mapMultipartCompletionDeadlineError(
      error,
      operationDeadline,
      requestDeadline,
    );
    if (
      completionError instanceof HttpError
      && completionError.code
        === "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED"
    ) {
      return resolveRecoveredMultipartAttempt(
        completionError,
        userId,
        session,
        attemptInput,
        writerLeaseTargetAtMs,
        observationScope,
        requestDeadline,
        replayResolutionDatabaseCommit,
        dependencies,
      );
    }
    throw completionError;
  }

  if (!("reservationToken" in attempt)) {
    if (attempt.status === "completion_pending") {
      throw createMultipartCompletionHandedOffError();
    }
    if (isMultipartAppliedStatus(attempt.status)) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    if (
      session.state === "completed"
      && attempt.status === "writer_conflict"
    ) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    if (
      attempt.status === "aborted"
      && isMediaAssetUploadSessionExpired(session)
    ) {
      throw createUploadSessionExpiredError(session);
    }
    throw createMultipartAttemptError(
      attempt.status,
      "leaseExpiresAt" in attempt ? attempt.leaseExpiresAt : null,
    );
  }

  let writer: MultipartMediaBlobWriterAttemptExactInput | null = null;
  let heartbeat: MultipartWriterHeartbeat | null = null;
  let lastConfirmedLeaseExpiresAtMs =
    parseMultipartWriterLeaseExpiresAtMs(attempt.leaseExpiresAt);
  try {
    operationDeadline.signal.throwIfAborted();
    const acquiredWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...attemptInput,
      reservationToken: attempt.reservationToken,
      normalizationVersion: attempt.normalizationVersion,
    };
    writer = acquiredWriter;
    heartbeat = createMultipartWriterHeartbeat(
      {
        storageCapability: attempt.storageCapability,
        leaseExpiresAt: attempt.leaseExpiresAt,
      },
      operationDeadline.signal,
      operationDeadline.deadlineAtMs,
      writerLeaseTargetAtMs,
      multipartWriterLeaseStorageAbortHeadroomMs,
      multipartWriterHeartbeatIntervalMs,
      async (): Promise<MultipartWriterLease> => {
        const renewal = await renewMultipartWriterLease(
          attemptInput,
          acquiredWriter,
          writerLeaseTargetAtMs,
          operationDeadline,
          replayOperationDatabaseCommit,
          dependencies
            .beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn,
        );
        return renewal;
      },
    );
    await heartbeat.renewNow();
    await dependencies.completeMultipartMediaAssetUploadFn({
      writer: acquiredWriter,
      getStorageCapability: heartbeat.getStorageCapability,
      assertStorageMutationAuthorized:
        heartbeat.assertStorageMutationAuthorized,
      signal: heartbeat.signal,
      workspaceId: session.workspaceId,
      mediaAssetId: session.mediaAssetId,
      stagingStorageKey: session.stagingStorageKey,
      blobStorageKey: session.blobStorageKey,
      s3UploadId: session.s3UploadId,
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      sha256: session.mediaBlobSha256,
      lastOperationId: session.lastOperationId,
      parts,
      observationScope,
    });
    await heartbeat.stopAndRenewForFinalization();
    heartbeat.throwIfFailed();
    return await replayOperationDatabaseCommit(
      () => dependencies.completeMediaAssetUploadSessionForWorkspaceFn(
        userId,
        session.workspaceId,
        session.sessionId,
        acquiredWriter,
      ),
    );
  } catch (completionError) {
    if (heartbeat !== null) {
      await heartbeat.stop();
      lastConfirmedLeaseExpiresAtMs =
        heartbeat.getLastConfirmedLeaseExpiresAtMs();
    }
    const exactWriter: MultipartMediaBlobWriterAttemptExactInput =
      writer ?? {
        ...attemptInput,
        reservationToken: attempt.reservationToken,
        normalizationVersion: attempt.normalizationVersion,
      };
    if (
      isMultipartCompletionDeadlineFailure(
        completionError,
        operationDeadline,
        requestDeadline,
      )
    ) {
      return handoffAcceptedMultipartAttempt(
        mapMultipartCompletionDeadlineError(
          completionError,
          operationDeadline,
          requestDeadline,
        ),
        userId,
        session,
        exactWriter,
        lastConfirmedLeaseExpiresAtMs,
        observationScope,
        requestDeadline,
        replayResolutionDatabaseCommit,
        dependencies,
      );
    }
    if (
      completionError instanceof MultipartWriterLeaseRenewalRejectedError
    ) {
      try {
        captureBackendWarning({
          action: "media_asset_upload_session_completion_renewal_rejected",
          scope: observationScope,
          details: {
            mediaAssetId: session.mediaAssetId,
            sessionId: session.sessionId,
            durableOutcome: completionError.durableOutcome,
          },
        });
      } catch {
        // Observability must not interrupt exact multipart attempt resolution.
      }
      if (
        completionError.durableOutcome === "already_applied"
        || completionError.durableOutcome === "live_applied"
        || completionError.durableOutcome === "referenced"
      ) {
        return replayCompletedMultipartResult(
          userId,
          session,
          replayResolutionDatabaseCommit,
          dependencies
            .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
        );
      }
      return handoffAcceptedMultipartAttempt(
        completionError.fallbackError,
        userId,
        session,
        exactWriter,
        lastConfirmedLeaseExpiresAtMs,
        observationScope,
        requestDeadline,
        replayResolutionDatabaseCommit,
        dependencies,
      );
    }
    let exactResolution:
      MultipartExactResolutionResult<MultipartMediaBlobWriterAttemptHandoffStatus>;
    try {
      exactResolution = await resolveMultipartOperationExactlyUntilSafe(
        () => resolveMultipartAttemptFailure(
          exactWriter,
          dependencies,
        ),
        lastConfirmedLeaseExpiresAtMs,
        requestDeadline,
        observationScope,
      );
    } catch (resolutionError) {
      throw createMultipartCompletionResolutionError(
        completionError,
        mapMultipartCompletionDeadlineError(
          resolutionError,
          operationDeadline,
          requestDeadline,
        ),
      );
    }
    if (exactResolution.kind === "safe_lease_expired") {
      if (exactResolution.resolutionError === null) throw completionError;
      throw createMultipartCompletionResolutionError(
        completionError,
        exactResolution.resolutionError,
      );
    }
    const resolution = exactResolution.value;
    if (isMultipartAppliedStatus(resolution)) {
      return replayCompletedMultipartResult(
        userId,
        session,
        replayResolutionDatabaseCommit,
        dependencies
          .loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn,
      );
    }
    if (resolution === "handed_off" || resolution === "already_pending") {
      throw createMultipartCompletionHandedOffError();
    }
    if (resolution === "unreferenced_restored") throw completionError;
    if (resolution === "unreferenced") {
      throw createMultipartAttemptError("access_denied", null);
    }
    throw createMultipartAttemptError(resolution, null);
  } finally {
    if (heartbeat !== null) await heartbeat.stop();
  }
}
