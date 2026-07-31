import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { Hono } from "hono";
import {
  loadMediaAssetForWorkspace,
  loadMediaAssetWithBlobForWorkspace,
} from "../mediaAssets";
import {
  assertMediaAssetUploadSessionPartNumbersInRange,
  assertMediaAssetUploadSessionCompletionPartsMatch,
  assertMediaAssetUploadSessionSupportsDurableCompletion,
  acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
  closeMediaAssetUploadSessionCurrentBlobWriter,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  createMediaAssetFromAvailableBlobForWorkspace,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  isMediaAssetUploadSessionExpired,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  loadMediaAssetUploadSessionCreationReplayForWorkspace,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  loadMediaAssetUploadSessionForWorkspace,
  recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  releaseMediaAssetUploadSessionCreationClaimForWorkspace,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MediaAssetUploadSessionAbortStartWithWriterResult,
  type MediaAssetUploadSessionCreationClaimResult,
  type MediaAssetUploadSessionCreationReplayResult,
  type MultipartMediaBlobStorageCapability,
  type MultipartMediaBlobWriterAttemptBeginStatus,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptFailureStatus,
  type MultipartMediaBlobWriterAttemptHandoffStatus,
  type MultipartMediaBlobWriterAttemptInput,
  type MultipartMediaBlobWriterAttemptResult,
} from "../mediaAssets/uploadSessions";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../mediaAssets/storageKeys";
import {
  abortMultipartMediaAssetUpload,
  abortMultipartMediaAssetUploadUntilDeadline,
  completeMultipartMediaAssetUpload,
  createMultipartMediaAssetUpload,
  createPresignedMediaAssetDownload,
  createPresignedMediaAssetUploadParts,
} from "../mediaAssets/storage";
import {
  parseCompleteMediaAssetUploadSessionInput,
  parseMediaAssetImageIngestionMetadataHeaders,
  parseMediaAssetIdParam,
  parseMediaAssetUploadSessionCreateInput,
  parseMediaAssetUploadSessionIdParam,
  parseMediaAssetUploadSessionPartUrlsInput,
} from "../mediaAssets/validators";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import {
  loadRequestContextFromRequest,
  loadRequestContextFromRequestWithAbortSignal,
  parseWorkspaceIdParam,
  type RequestContext,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  captureBackendWarning,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import {
  MediaBlobLifecycleBusyError,
  MediaBlobWriterFenceError,
} from "../mediaAssets/blobLifecycle";
import {
  DatabaseDeadlineExceededError,
  runDatabaseOperationsWithDeadline,
} from "../database";
import {
  DatabaseCommitOutcomeUnknownError,
  getDatabaseErrorFields,
  isTransientDatabaseError,
  TransientDatabaseHttpError,
} from "../database/transient";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAsset,
  MediaAssetUploadSession,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionCreateResult,
} from "../mediaAssets/types";
import { passthroughMediaBlobNormalizationVersion } from "../mediaAssets/types";
import { isValidMediaAssetLastOperationId } from "../mediaAssets/lastOperationId";
import { createDirectImageIngestionRoutes } from "./directImageIngestion";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
  createStandaloneMultipartCompletionRequestTiming,
  getMultipartCompletionRequestTimingContext,
} from "../server/multipartCompletionRequestTiming";

type MediaAssetsRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function getRequestContextUserId(requestContext: RequestContext | null): string | null {
  return requestContext === null ? null : requestContext.userId;
}

function createMediaAssetsScope(
  requestId: string,
  route: string,
  method: string,
  userId: string | null,
  workspaceId: string | null,
  clientAppVersion: string | null,
  clientPlatform: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
    clientAppVersion,
    clientPlatform,
  );
}

const multipartWriterHeartbeatIntervalMs = 5_000;
const multipartWriterLeaseStorageAbortHeadroomMs = 250;
const multipartWriterLeaseExpiryObservationPaddingMs = 100;
const multipartDatabaseCommitReplayDelayMs = 25;
const multipartResolutionRetryBaseDelayMs = 50;
const multipartResolutionRetryMaximumDelayMs = 250;

export type MultipartCompletionRequestDeadline = Readonly<{
  deadlineAtMs: number;
  signal: AbortSignal;
  dispose: () => void;
}>;

type MultipartDatabaseCommitReplay = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

const runDatabaseOperationOnce: MultipartDatabaseCommitReplay =
  <Result>(operation: () => Promise<Result>): Promise<Result> => operation();

export function createMultipartCompletionRequestDeadline(
  deadlineAtMs: number,
): MultipartCompletionRequestDeadline {
  const controller = new AbortController();
  const deadlineError = createMultipartCompletionDeadlineError();
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    controller.abort(deadlineError);
    return Object.freeze({
      deadlineAtMs,
      signal: controller.signal,
      dispose: () => {},
    });
  }
  const timer = setTimeout(
    () => controller.abort(deadlineError),
    remainingMs,
  );
  timer.unref();
  return Object.freeze({
    deadlineAtMs,
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  });
}

function assertMultipartCompletionRequestActive(
  deadlineAtMs: number,
  signal: AbortSignal,
): void {
  signal.throwIfAborted();
  if (Date.now() >= deadlineAtMs) {
    throw createMultipartCompletionDeadlineError();
  }
}

export async function replayMultipartDatabaseCommitUnknownUntilDeadline<Result>(
  operation: () => Promise<Result>,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<Result> {
  for (;;) {
    assertMultipartCompletionRequestActive(deadlineAtMs, signal);
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DatabaseCommitOutcomeUnknownError)) {
        throw error;
      }
      assertMultipartCompletionRequestActive(deadlineAtMs, signal);
      const waitMs = Math.min(
        multipartDatabaseCommitReplayDelayMs,
        deadlineAtMs - Date.now(),
      );
      if (waitMs <= 0) throw createMultipartCompletionDeadlineError();
      try {
        await wait(waitMs, undefined, { signal });
      } catch (waitError) {
        if (signal.aborted) signal.throwIfAborted();
        throw waitError;
      }
    }
  }
}

function createMultipartDatabaseCommitReplay(
  requestDeadline: MultipartCompletionRequestDeadline,
): MultipartDatabaseCommitReplay {
  return <Result>(operation: () => Promise<Result>): Promise<Result> =>
    replayMultipartDatabaseCommitUnknownUntilDeadline(
      () => runDatabaseOperationsWithDeadline(
        requestDeadline.deadlineAtMs,
        operation,
      ),
      requestDeadline.deadlineAtMs,
      requestDeadline.signal,
    );
}

function hasSqlState(error: unknown, sqlState: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === sqlState;
}

function toMultipartAttemptInput(
  attemptToken: string,
  userId: string,
  session: MediaAssetUploadSession,
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>,
): MultipartMediaBlobWriterAttemptInput {
  return {
    attemptToken,
    userId,
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    mediaAssetId: session.mediaAssetId,
    lastModifiedByReplicaId: session.lastModifiedByReplicaId,
    lastOperationId: session.lastOperationId,
    sha256: session.mediaBlobSha256,
    stagingStorageKey: session.stagingStorageKey,
    blobStorageKey: session.blobStorageKey,
    s3UploadId: session.s3UploadId,
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
    partSizeBytes: session.partSizeBytes,
    partCount: session.partCount,
    sourceUrl: session.sourceUrl,
    assetCreatedAt: session.assetCreatedAt,
    clientUpdatedAt: session.clientUpdatedAt,
    expiresAt: session.expiresAt,
    normalizationVersion: passthroughMediaBlobNormalizationVersion,
    completedPartsFingerprint:
      createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
  };
}

function createUploadSessionExpiredError(
  session: MediaAssetUploadSession,
): HttpError {
  return new HttpError(
    409,
    `Media asset upload session is expired. sessionId=${session.sessionId} expiresAt=${session.expiresAt}`,
    "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
  );
}

function createMultipartCompletionDeadlineError(): HttpError {
  return new HttpError(
    503,
    "Multipart completion could not safely finish within the request deadline. Retry the same completion request without aborting the upload session.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
}

function createMultipartCompletionInProgressError(
  statusCode: 409 | 503,
  message: string,
  retryAfterSeconds: number,
): HttpError {
  return new HttpError(
    statusCode,
    message,
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    { retryAfterSeconds },
  );
}

function createMultipartCompletionHandedOffError(): HttpError {
  return createMultipartCompletionInProgressError(
    503,
    "Multipart completion was accepted for durable processing. Retry after the Retry-After delay without aborting or replacing the upload session.",
    1,
  );
}

const multipartUploadSessionCreationClaimLeaseDurationMs = 60_000;
const multipartUploadSessionCreationMaximumOperationReserveMs = 5_000;
const multipartUploadSessionCreationMinimumOperationReserveMs = 100;
const multipartUploadSessionCreationReleasePaddingMs = 25;
const multipartUploadSessionCreationCommitReplayMaxAttempts = 3;
const multipartUploadSessionCreationCommitReplayDelayMs = 25;
const multipartUploadSessionCreationCleanupTimeoutMs = 5_000;

type MultipartUploadSessionCreationDeadline = Readonly<{
  deadlineAtMs: number;
  releaseDeadlineAtMs: number;
  signal: AbortSignal;
  dispose: () => void;
}>;

export type MultipartUploadSessionCreationApplicationDependencies =
Readonly<{
  abortMultipartMediaAssetUploadUntilDeadlineFn:
    typeof abortMultipartMediaAssetUploadUntilDeadline;
  acquireCreationClaimFn:
    typeof acquireMediaAssetUploadSessionCreationClaimForWorkspace;
  createMediaAssetFromAvailableBlobForWorkspaceFn:
    typeof createMediaAssetFromAvailableBlobForWorkspace;
  createMultipartMediaAssetUploadFn:
    typeof createMultipartMediaAssetUpload;
  loadCreationReplayFn:
    typeof loadMediaAssetUploadSessionCreationReplayForWorkspace;
  recordUploadSessionWithCreationClaimFn:
    typeof recordMediaAssetUploadSessionWithCreationClaimForWorkspace;
  releaseCreationClaimFn:
    typeof releaseMediaAssetUploadSessionCreationClaimForWorkspace;
}>;

export type MultipartUploadSessionCreationApplicationResult = Readonly<{
  sessionResult: MediaAssetUploadSessionCreateResult;
  multipartUploadCreated: boolean;
}>;

const multipartUploadSessionCreationApplicationDependencies:
MultipartUploadSessionCreationApplicationDependencies = Object.freeze({
  abortMultipartMediaAssetUploadUntilDeadlineFn:
    abortMultipartMediaAssetUploadUntilDeadline,
  acquireCreationClaimFn:
    acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  createMediaAssetFromAvailableBlobForWorkspaceFn:
    createMediaAssetFromAvailableBlobForWorkspace,
  createMultipartMediaAssetUploadFn: createMultipartMediaAssetUpload,
  loadCreationReplayFn:
    loadMediaAssetUploadSessionCreationReplayForWorkspace,
  recordUploadSessionWithCreationClaimFn:
    recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  releaseCreationClaimFn:
    releaseMediaAssetUploadSessionCreationClaimForWorkspace,
});

function createMultipartUploadSessionCreationInProgressError(
  message: string,
  retryAfterSeconds: number,
): HttpError {
  return new HttpError(
    503,
    message,
    "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
    { retryAfterSeconds },
  );
}

function createMultipartUploadSessionCompletionInProgressError(
  message: string,
  retryAfterSeconds: number,
): HttpError {
  return new HttpError(
    503,
    message,
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
    { retryAfterSeconds },
  );
}

function isMultipartUploadSessionCreationReplayPendingError(
  error: unknown,
): error is HttpError {
  if (
    !(error instanceof HttpError)
    || error.statusCode !== 503
    || (
      error.code !== "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS"
      && error.code !== "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS"
    )
  ) {
    return false;
  }
  const retryAfterSeconds = error.details?.retryAfterSeconds;
  return retryAfterSeconds !== undefined
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds >= 1
    && retryAfterSeconds <= 60;
}

function calculateMultipartCreationRetryAfterSeconds(retryAt: string): number {
  const retryAtMs = Date.parse(retryAt);
  if (!Number.isFinite(retryAtMs)) {
    throw new TypeError(
      "Media upload session creation claim returned an invalid retry timestamp.",
    );
  }
  return Math.max(
    1,
    Math.min(60, Math.ceil((retryAtMs - Date.now()) / 1_000)),
  );
}

function throwMultipartUploadSessionCreationClaimRejection(
  claim: Exclude<
    MediaAssetUploadSessionCreationClaimResult,
    Readonly<{ status: "acquired"; leaseExpiresAt: string }>
    | Readonly<{ status: "finalized"; uploadSessionId: string }>
  >,
): never {
  if (claim.status === "completion_pending") {
    throw createMultipartUploadSessionCompletionInProgressError(
      "Multipart completion is being durably reconciled for this media asset. Retry session creation after the Retry-After delay.",
      calculateMultipartCreationRetryAfterSeconds(claim.retryAt),
    );
  }
  if (claim.status === "creation_pending") {
    throw createMultipartUploadSessionCreationInProgressError(
      "Another multipart upload session creation owns this media asset. Retry this request after the Retry-After delay.",
      calculateMultipartCreationRetryAfterSeconds(claim.retryAt),
    );
  }
  if (claim.status === "access_denied") {
    throw new HttpError(
      403,
      "Workspace access changed during multipart upload session creation.",
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    );
  }
  if (claim.status === "replica_mismatch") {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
  throw createMultipartUploadSessionCreationInProgressError(
    `Multipart upload session creation lost its exact claim. status=${claim.status}`,
    1,
  );
}

function createMultipartUploadSessionCreationDeadlineError(): HttpError {
  return createMultipartUploadSessionCreationInProgressError(
    "Multipart upload session creation could not finish safely before its exact claim lease expired. Retry the unchanged request.",
    1,
  );
}

function createMultipartUploadSessionCreationDeadline(
  leaseExpiresAt: string,
  requestSignal: AbortSignal,
): MultipartUploadSessionCreationDeadline {
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) {
    throw new TypeError(
      "Media upload session creation claim returned an invalid lease timestamp.",
    );
  }
  const remainingLeaseMs = leaseExpiresAtMs - Date.now();
  const operationReserveMs = Math.min(
    multipartUploadSessionCreationMaximumOperationReserveMs,
    Math.max(
      multipartUploadSessionCreationMinimumOperationReserveMs,
      Math.floor(remainingLeaseMs / 4),
    ),
  );
  const deadlineAtMs = leaseExpiresAtMs - operationReserveMs;
  if (deadlineAtMs <= Date.now()) {
    throw createMultipartUploadSessionCreationDeadlineError();
  }

  const deadlineController = new AbortController();
  const timeout = setTimeout(
    () => deadlineController.abort(
      createMultipartUploadSessionCreationDeadlineError(),
    ),
    deadlineAtMs - Date.now(),
  );
  timeout.unref();
  return Object.freeze({
    deadlineAtMs,
    releaseDeadlineAtMs:
      leaseExpiresAtMs - multipartUploadSessionCreationReleasePaddingMs,
    signal: AbortSignal.any([requestSignal, deadlineController.signal]),
    dispose: () => clearTimeout(timeout),
  });
}

function runMultipartUploadSessionCreationDatabaseOperation<Result>(
  deadline: MultipartUploadSessionCreationDeadline,
  operation: () => Promise<Result>,
): Promise<Result> {
  deadline.signal.throwIfAborted();
  return runDatabaseOperationsWithDeadline(
    deadline.deadlineAtMs,
    async () => {
      deadline.signal.throwIfAborted();
      return operation();
    },
  );
}

async function replayMultipartUploadSessionCreationCommitUnknown<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  let attempt = 1;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof DatabaseCommitOutcomeUnknownError)
        || attempt === multipartUploadSessionCreationCommitReplayMaxAttempts
      ) {
        throw error;
      }
      await wait(multipartUploadSessionCreationCommitReplayDelayMs);
      attempt += 1;
    }
  }
}

async function replayLeasedMultipartUploadSessionCreationCommitUnknown<Result>(
  deadline: MultipartUploadSessionCreationDeadline,
  operation: () => Promise<Result>,
): Promise<Result> {
  let attempt = 1;
  for (;;) {
    try {
      return await runMultipartUploadSessionCreationDatabaseOperation(
        deadline,
        operation,
      );
    } catch (error) {
      if (
        !(error instanceof DatabaseCommitOutcomeUnknownError)
        || attempt === multipartUploadSessionCreationCommitReplayMaxAttempts
      ) {
        throw error;
      }
      await wait(
        multipartUploadSessionCreationCommitReplayDelayMs,
        undefined,
        { signal: deadline.signal },
      );
      attempt += 1;
    }
  }
}

function createMultipartUploadSessionCreationAggregateError(
  message: string,
  errors: ReadonlyArray<unknown>,
): Error {
  const normalizedErrors = errors.map(normalizeCaughtError);
  return new Error(message, {
    cause: new AggregateError(normalizedErrors, message),
  });
}

async function releaseMultipartUploadSessionCreationClaim(
  userId: string,
  workspaceId: string,
  claimToken: string,
  input: MediaAssetUploadSessionCreateInput,
  deadline: MultipartUploadSessionCreationDeadline,
  dependencies: MultipartUploadSessionCreationApplicationDependencies,
): Promise<"released" | "finalized"> {
  return replayMultipartUploadSessionCreationCommitUnknown(
    () => runDatabaseOperationsWithDeadline(
      deadline.releaseDeadlineAtMs,
      () => dependencies.releaseCreationClaimFn(
        userId,
        workspaceId,
        input.mediaAssetId,
        input.lastModifiedByReplicaId,
        claimToken,
      ),
    ),
  );
}

async function runBoundedMultipartUploadSessionCreationCleanup(
  operation: (signal: AbortSignal) => Promise<void>,
): Promise<Error | null> {
  const controller = new AbortController();
  const timeoutError = new Error(
    "Orphaned multipart upload cleanup exceeded its bounded deadline.",
  );
  const timeout = setTimeout(
    () => controller.abort(timeoutError),
    multipartUploadSessionCreationCleanupTimeoutMs,
  );
  timeout.unref();
  let rejectForAbort: ((reason: unknown) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const onAbort = (): void => {
    rejectForAbort?.(controller.signal.reason ?? timeoutError);
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([operation(controller.signal), aborted]);
    return null;
  } catch (error) {
    return normalizeCaughtError(error);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

async function releaseMultipartUploadSessionCreationClaimAfterFailure(
  userId: string,
  workspaceId: string,
  claimToken: string,
  input: MediaAssetUploadSessionCreateInput,
  deadline: MultipartUploadSessionCreationDeadline,
  creationError: unknown,
  dependencies: MultipartUploadSessionCreationApplicationDependencies,
): Promise<never> {
  let releaseStatus: "released" | "finalized";
  try {
    releaseStatus = await releaseMultipartUploadSessionCreationClaim(
      userId,
      workspaceId,
      claimToken,
      input,
      deadline,
      dependencies,
    );
  } catch (releaseError) {
    throw createMultipartUploadSessionCreationAggregateError(
      `Multipart upload session creation failed and its exact claim could not be released. mediaAssetId=${input.mediaAssetId} claimToken=${claimToken}`,
      [creationError, releaseError],
    );
  }
  if (releaseStatus === "finalized") {
    throw createMultipartUploadSessionCreationAggregateError(
      `Multipart upload session creation failed after its exact claim was already finalized. mediaAssetId=${input.mediaAssetId} claimToken=${claimToken}`,
      [
        creationError,
        new Error("The exact replacement-creation claim is finalized."),
      ],
    );
  }
  throw creationError;
}

async function settleFailedMultipartUploadSessionPersistence(
  userId: string,
  workspaceId: string,
  sessionId: string,
  claimToken: string,
  input: MediaAssetUploadSessionCreateInput,
  stagingStorageKey: string,
  s3UploadId: string,
  observationScope: BackendObservationScope,
  deadline: MultipartUploadSessionCreationDeadline,
  persistenceError: unknown,
  dependencies: MultipartUploadSessionCreationApplicationDependencies,
): Promise<MediaAssetUploadSessionCreateResult> {
  let releaseStatus: "released" | "finalized" | null = null;
  let releaseError: Error | null = null;
  try {
    releaseStatus = await releaseMultipartUploadSessionCreationClaim(
      userId,
      workspaceId,
      claimToken,
      input,
      deadline,
      dependencies,
    );
  } catch (error) {
    releaseError = normalizeCaughtError(error);
  }

  if (releaseStatus === "finalized") {
    try {
      const replay = await replayMultipartUploadSessionCreation(
        userId,
        workspaceId,
        sessionId,
        input,
        dependencies,
      );
      return replay.sessionResult;
    } catch (replayError) {
      if (
        isMultipartUploadSessionCreationReplayPendingError(replayError)
      ) {
        throw replayError;
      }
      throw createMultipartUploadSessionCreationAggregateError(
        `Multipart upload session persistence outcome was finalized but its exact committed session could not be replayed. mediaAssetId=${input.mediaAssetId} sessionId=${sessionId} claimToken=${claimToken}`,
        [persistenceError, replayError],
      );
    }
  }

  const cleanupError =
    await runBoundedMultipartUploadSessionCreationCleanup(
      (signal) =>
        dependencies.abortMultipartMediaAssetUploadUntilDeadlineFn({
          signal,
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          stagingStorageKey,
          s3UploadId,
          observationScope,
        }),
    );
  const secondaryErrors = [
    ...(releaseError === null ? [] : [releaseError]),
    ...(cleanupError === null ? [] : [cleanupError]),
  ];
  if (secondaryErrors.length > 0) {
    throw createMultipartUploadSessionCreationAggregateError(
      `Multipart upload session persistence failed and exact claim release or orphaned S3 cleanup also failed. mediaAssetId=${input.mediaAssetId} sessionId=${sessionId} claimToken=${claimToken}`,
      [persistenceError, ...secondaryErrors],
    );
  }
  throw persistenceError;
}

async function replayMultipartUploadSessionCreation(
  userId: string,
  workspaceId: string,
  uploadSessionId: string,
  input: MediaAssetUploadSessionCreateInput,
  dependencies: MultipartUploadSessionCreationApplicationDependencies,
): Promise<MultipartUploadSessionCreationApplicationResult> {
  const replay: MediaAssetUploadSessionCreationReplayResult =
    await dependencies.loadCreationReplayFn(
      userId,
      workspaceId,
      uploadSessionId,
      input,
    );
  if (replay.state === "completing") {
    throw createMultipartUploadSessionCompletionInProgressError(
      "Multipart completion owns the committed upload session for this media asset. Retry session creation after the Retry-After delay.",
      calculateMultipartCreationRetryAfterSeconds(
        replay.uploadSession.expiresAt,
      ),
    );
  }
  if (replay.state === "aborting") {
    throw createMultipartUploadSessionCreationInProgressError(
      "The committed multipart upload session for this media asset is being aborted. Retry session creation after the Retry-After delay.",
      calculateMultipartCreationRetryAfterSeconds(
        replay.uploadSession.expiresAt,
      ),
    );
  }
  return {
    sessionResult: {
      status: "upload_required",
      uploadSession: replay.uploadSession,
    },
    multipartUploadCreated: false,
  };
}

export async function createMultipartUploadSessionAtApplicationBoundary(
  userId: string,
  workspaceId: string,
  sessionId: string,
  claimToken: string,
  input: MediaAssetUploadSessionCreateInput,
  stagingStorageKey: string,
  blobStorageKey: string,
  observationScope: BackendObservationScope,
  requestSignal: AbortSignal,
  claimLeaseDurationMs: number,
  dependencies: MultipartUploadSessionCreationApplicationDependencies,
): Promise<MultipartUploadSessionCreationApplicationResult> {
  const claim = await replayMultipartUploadSessionCreationCommitUnknown(
    () => dependencies.acquireCreationClaimFn(
      userId,
      workspaceId,
      input.mediaAssetId,
      input.lastModifiedByReplicaId,
      claimToken,
      claimLeaseDurationMs,
    ),
  );
  if (claim.status === "finalized") {
    return replayMultipartUploadSessionCreation(
      userId,
      workspaceId,
      claim.uploadSessionId,
      input,
      dependencies,
    );
  }
  if (
    claim.status === "creation_pending"
    && claim.uploadSessionId !== null
  ) {
    return replayMultipartUploadSessionCreation(
      userId,
      workspaceId,
      claim.uploadSessionId,
      input,
      dependencies,
    );
  }
  if (claim.status !== "acquired") {
    throwMultipartUploadSessionCreationClaimRejection(claim);
  }

  let deadline: MultipartUploadSessionCreationDeadline;
  try {
    deadline = createMultipartUploadSessionCreationDeadline(
      claim.leaseExpiresAt,
      requestSignal,
    );
  } catch (deadlineError) {
    try {
      await replayMultipartUploadSessionCreationCommitUnknown(
        () => dependencies.releaseCreationClaimFn(
          userId,
          workspaceId,
          input.mediaAssetId,
          input.lastModifiedByReplicaId,
          claimToken,
        ),
      );
    } catch (releaseError) {
      throw createMultipartUploadSessionCreationAggregateError(
        `Multipart upload session creation could not establish a safe lease deadline or release its exact claim. mediaAssetId=${input.mediaAssetId} claimToken=${claimToken}`,
        [deadlineError, releaseError],
      );
    }
    throw deadlineError;
  }
  try {
    let availableResult: Awaited<
      ReturnType<typeof createMediaAssetFromAvailableBlobForWorkspace>
    >;
    try {
      availableResult =
        await runMultipartUploadSessionCreationDatabaseOperation(
          deadline,
          () =>
            dependencies.createMediaAssetFromAvailableBlobForWorkspaceFn(
              userId,
              workspaceId,
              input,
            ),
        );
    } catch (error) {
      return releaseMultipartUploadSessionCreationClaimAfterFailure(
        userId,
        workspaceId,
        claimToken,
        input,
        deadline,
        error,
        dependencies,
      );
    }
    if (availableResult !== null) {
      const releaseStatus =
        await releaseMultipartUploadSessionCreationClaim(
          userId,
          workspaceId,
          claimToken,
          input,
          deadline,
          dependencies,
        );
      if (releaseStatus !== "released") {
        throw new Error(
          `Available media reuse could not release its exact multipart upload session creation claim. mediaAssetId=${input.mediaAssetId} claimToken=${claimToken} releaseStatus=${releaseStatus}`,
        );
      }
      return {
        sessionResult: {
          status: "already_available",
          mediaAsset: availableResult.mediaAsset,
          applied: availableResult.applied,
        },
        multipartUploadCreated: false,
      };
    }

    let multipartUpload: Awaited<
      ReturnType<typeof createMultipartMediaAssetUpload>
    >;
    try {
      deadline.signal.throwIfAborted();
      multipartUpload =
        await dependencies.createMultipartMediaAssetUploadFn({
          signal: deadline.signal,
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          stagingStorageKey,
          mimeType: input.mimeType,
          sha256: input.sha256,
          lastOperationId: input.lastOperationId,
          observationScope,
        });
    } catch (error) {
      return releaseMultipartUploadSessionCreationClaimAfterFailure(
        userId,
        workspaceId,
        claimToken,
        input,
        deadline,
        error,
        dependencies,
      );
    }

    let sessionResult: MediaAssetUploadSessionCreateResult;
    try {
      sessionResult =
        await replayLeasedMultipartUploadSessionCreationCommitUnknown(
          deadline,
          () => dependencies.recordUploadSessionWithCreationClaimFn(
            userId,
            workspaceId,
            sessionId,
            claimToken,
            input,
            multipartUpload.storageKey,
            blobStorageKey,
            multipartUpload.s3UploadId,
            multipartUpload.expiresAt,
          ),
        );
    } catch (error) {
      sessionResult = await settleFailedMultipartUploadSessionPersistence(
        userId,
        workspaceId,
        sessionId,
        claimToken,
        input,
        stagingStorageKey,
        multipartUpload.s3UploadId,
        observationScope,
        deadline,
        error,
        dependencies,
      );
    }
    if (sessionResult.status === "upload_required") {
      return {
        sessionResult,
        multipartUploadCreated: true,
      };
    }

    const cleanupError =
      await runBoundedMultipartUploadSessionCreationCleanup(
        (signal) =>
          dependencies.abortMultipartMediaAssetUploadUntilDeadlineFn({
            signal,
            workspaceId,
            mediaAssetId: input.mediaAssetId,
            stagingStorageKey,
            s3UploadId: multipartUpload.s3UploadId,
            observationScope,
          }),
      );
    if (cleanupError !== null) {
      throw createMultipartUploadSessionCreationAggregateError(
        `Available media reuse succeeded but orphaned S3 upload cleanup failed. mediaAssetId=${input.mediaAssetId} sessionId=${sessionId} claimToken=${claimToken}`,
        [cleanupError],
      );
    }
    return {
      sessionResult,
      multipartUploadCreated: true,
    };
  } finally {
    deadline.dispose();
  }
}

function isMultipartCompletionDeadlineFailure(
  error: unknown,
  operationDeadline: MultipartCompletionRequestDeadline,
  requestDeadline: MultipartCompletionRequestDeadline,
): boolean {
  return operationDeadline.signal.aborted
    || requestDeadline.signal.aborted
    || error instanceof DatabaseDeadlineExceededError
    || hasSqlState(error, "57014")
    || hasSqlState(error, "55P03")
    || (
      error instanceof HttpError
      && error.code
        === "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED"
    );
}

function mapMultipartCompletionDeadlineError(
  error: unknown,
  operationDeadline: MultipartCompletionRequestDeadline,
  requestDeadline: MultipartCompletionRequestDeadline,
): unknown {
  if (error instanceof HttpError) return error;
  if (
    requestDeadline.signal.aborted
    || operationDeadline.signal.aborted
  ) {
    if (requestDeadline.signal.aborted) {
      return requestDeadline.signal.reason instanceof HttpError
        ? requestDeadline.signal.reason
        : createMultipartCompletionDeadlineError();
    }
    return operationDeadline.signal.reason instanceof HttpError
      ? operationDeadline.signal.reason
      : createMultipartCompletionDeadlineError();
  }
  if (
    error instanceof DatabaseDeadlineExceededError
    || hasSqlState(error, "57014")
    || hasSqlState(error, "55P03")
  ) {
    return createMultipartCompletionDeadlineError();
  }
  return error;
}

export function createMultipartCompletionResolutionError(
  completionError: unknown,
  resolutionError: unknown,
): Error {
  const diagnosticCause = new AggregateError(
    [completionError, resolutionError],
    "Multipart completion and exact attempt resolution both failed.",
  );
  if (resolutionError instanceof HttpError) {
    const preservedError = new HttpError(
      resolutionError.statusCode,
      resolutionError.message,
      resolutionError.code ?? undefined,
      resolutionError.details ?? undefined,
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

function createMultipartAttemptError(
  status:
    | MultipartMediaBlobWriterAttemptBeginStatus
    | MultipartMediaBlobWriterAttemptFailureStatus
    | MultipartMediaBlobWriterAttemptHandoffStatus,
  leaseExpiresAt: string | null,
): Error {
  if (status === "cleanup_claimed") {
    return new MediaBlobLifecycleBusyError();
  }
  if (status === "access_denied") {
    return new HttpError(
      403,
      "Workspace access changed during multipart completion.",
      "MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED",
    );
  }
  if (status === "replica_mismatch") {
    return new HttpError(
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
      return new TypeError(
        "Multipart writer busy status did not include a valid lease expiry.",
      );
    }
    return new HttpError(
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
  return new HttpError(
    409,
    `Multipart completion conflicts with its current writer state. status=${status}`,
    "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
  );
}

function isMultipartAppliedStatus(
  status:
    | MultipartMediaBlobWriterAttemptBeginStatus
    | MultipartMediaBlobWriterAttemptFailureStatus
    | MultipartMediaBlobWriterAttemptHandoffStatus,
): status is "already_applied" | "live_applied" | "referenced" {
  return status === "already_applied"
    || status === "live_applied"
    || status === "referenced";
}

export async function replayCompletedMultipartResultWithDependencies(
  userId: string,
  session: MediaAssetUploadSession,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  loadMediaAssetForReplay: (
    userId: string,
    session: MediaAssetUploadSession,
  ) => Promise<MediaAsset>,
): Promise<Readonly<{ mediaAsset: MediaAsset; applied: false }>> {
  const mediaAsset = await replayDatabaseCommit(
    () => loadMediaAssetForReplay(
      userId,
      session,
    ),
  );
  return { mediaAsset, applied: false };
}

async function replayCompletedMultipartResult(
  userId: string,
  session: MediaAssetUploadSession,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  loadMediaAssetForReplay:
    typeof loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
): Promise<Readonly<{ mediaAsset: MediaAsset; applied: false }>> {
  return replayCompletedMultipartResultWithDependencies(
    userId,
    session,
    replayDatabaseCommit,
    loadMediaAssetForReplay,
  );
}

export function isExpiredMultipartCompletionCleanupRequired(
  session: MediaAssetUploadSession,
): boolean {
  return (
    session.state === "active"
    || session.state === "aborting"
  ) && isMediaAssetUploadSessionExpired(session);
}

type MultipartAttemptResolutionDependencies = Readonly<{
  handoffCompletionAttemptAfterAccessRevocationFn:
    typeof handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation;
  resolveCompletionAttemptFailureWithOwnerFn:
    typeof resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner;
}>;

async function resolveMultipartAttemptFailure(
  writer: MultipartMediaBlobWriterAttemptExactInput,
  dependencies: MultipartAttemptResolutionDependencies,
): Promise<MultipartMediaBlobWriterAttemptHandoffStatus> {
  const resolveWithCurrentAccess =
    async (): Promise<MultipartMediaBlobWriterAttemptFailureStatus> => {
      try {
        return await dependencies.resolveCompletionAttemptFailureWithOwnerFn(
          writer,
        );
      } catch (error) {
        if (hasSqlState(error, "42501")) return "access_denied";
        throw error;
      }
    };
  const status = await resolveWithCurrentAccess();
  if (status !== "access_denied" && status !== "replica_mismatch") {
    return status;
  }
  return dependencies.handoffCompletionAttemptAfterAccessRevocationFn(
    writer,
  );
}

type MultipartExactResolutionResult<Result> =
  | Readonly<{
    kind: "resolved";
    value: Result;
  }>
  | Readonly<{
    kind: "safe_lease_expired";
    resolutionError: unknown;
  }>;

function isRetryableMultipartResolutionError(error: unknown): boolean {
  return error instanceof DatabaseCommitOutcomeUnknownError
    || error instanceof TransientDatabaseHttpError
    || isTransientDatabaseError(error);
}

function calculateMultipartResolutionRetryDelayMs(attempt: number): number {
  return Math.min(
    multipartResolutionRetryMaximumDelayMs,
    multipartResolutionRetryBaseDelayMs * (2 ** Math.min(attempt - 1, 8)),
  );
}

function captureMultipartResolutionRetryWarning(
  observationScope: BackendObservationScope,
  attempt: number,
  delayMs: number,
  leaseExpiresAtMs: number,
  error: unknown,
): void {
  const fields = getDatabaseErrorFields(error);
  try {
    captureBackendWarning({
      action: "media_asset_upload_session_completion_resolution_retry",
      scope: observationScope,
      details: {
        attempt,
        delayMs,
        leaseExpiresAtMs,
        sqlState: fields.sqlState,
        errorCode: fields.errorCode,
        errorClass: fields.errorClass,
        errorMessage: fields.errorMessage,
      },
    });
  } catch {
    // Observability must not interrupt exact multipart attempt resolution.
  }
}

async function waitForMultipartWriterLeaseExpiry(
  deadline: MultipartCompletionRequestDeadline,
): Promise<void> {
  const remainingMs = deadline.deadlineAtMs - Date.now();
  if (remainingMs <= 0) return;
  try {
    await wait(remainingMs, undefined, { signal: deadline.signal });
  } catch (error) {
    if (deadline.signal.aborted) return;
    throw error;
  }
}

export async function resolveMultipartOperationExactlyUntilSafe<Result>(
  operation: () => Promise<Result>,
  lastConfirmedLeaseExpiresAtMs: number,
  requestDeadline: MultipartCompletionRequestDeadline,
  observationScope: BackendObservationScope,
): Promise<MultipartExactResolutionResult<Result>> {
  if (
    !Number.isSafeInteger(lastConfirmedLeaseExpiresAtMs)
    || lastConfirmedLeaseExpiresAtMs < 1
  ) {
    throw new RangeError(
      "Exact multipart resolution requires a valid confirmed lease expiry.",
    );
  }
  const safeLeaseExpiryAtMs =
    lastConfirmedLeaseExpiresAtMs
      + multipartWriterLeaseExpiryObservationPaddingMs;
  if (safeLeaseExpiryAtMs >= requestDeadline.deadlineAtMs) {
    throw new RangeError(
      "Confirmed multipart writer lease does not expire safely before the request resolution deadline.",
    );
  }
  const cleanupDeadline =
    createMultipartCompletionRequestDeadline(safeLeaseExpiryAtMs);
  let attempt = 1;
  let lastResolutionError: unknown = null;
  try {
    for (;;) {
      if (Date.now() >= safeLeaseExpiryAtMs) {
        return {
          kind: "safe_lease_expired",
          resolutionError: lastResolutionError,
        };
      }
      try {
        const value = await runDatabaseOperationsWithDeadline(
          safeLeaseExpiryAtMs,
          operation,
        );
        return { kind: "resolved", value };
      } catch (error) {
        lastResolutionError = error;
        if (!isRetryableMultipartResolutionError(error)) {
          await waitForMultipartWriterLeaseExpiry(cleanupDeadline);
          return {
            kind: "safe_lease_expired",
            resolutionError: error,
          };
        }
        const remainingMs = safeLeaseExpiryAtMs - Date.now();
        if (remainingMs <= 0) {
          return {
            kind: "safe_lease_expired",
            resolutionError: error,
          };
        }
        const delayMs = Math.min(
          calculateMultipartResolutionRetryDelayMs(attempt),
          remainingMs,
        );
        captureMultipartResolutionRetryWarning(
          observationScope,
          attempt,
          delayMs,
          lastConfirmedLeaseExpiresAtMs,
          error,
        );
        try {
          await wait(delayMs, undefined, {
            signal: cleanupDeadline.signal,
          });
        } catch (waitError) {
          if (!cleanupDeadline.signal.aborted) throw waitError;
        }
        attempt += 1;
      }
    }
  } finally {
    cleanupDeadline.dispose();
  }
}

type MultipartWriterLease = Readonly<{
  storageCapability: MultipartMediaBlobStorageCapability;
  leaseExpiresAt: string;
}>;

type MultipartWriterLeaseRenewalOutcome =
  | MultipartMediaBlobWriterAttemptBeginStatus
  | "completion_pending"
  | "acquired"
  | "expired_takeover"
  | "replayed_reservation_mismatch"
  | "replayed_normalization_mismatch"
  | "replayed_writer_mismatch";

class MultipartWriterLeaseRenewalRejectedError extends Error {
  readonly durableOutcome: MultipartWriterLeaseRenewalOutcome;
  readonly fallbackError: Error;

  constructor(
    durableOutcome: MultipartWriterLeaseRenewalOutcome,
    fallbackError: Error,
  ) {
    super(
      `Multipart writer lease renewal no longer matched the exact foreground writer. durableOutcome=${durableOutcome}`,
    );
    this.name = "MultipartWriterLeaseRenewalRejectedError";
    this.durableOutcome = durableOutcome;
    this.fallbackError = fallbackError;
  }
}

function createMultipartWriterLeaseRenewalFenceFallback(): Error {
  const fenceError =
    new MediaBlobWriterFenceError("multipart_attempt_renewal");
  const fallbackError = createMultipartAttemptError("stale_attempt", null);
  Object.defineProperty(fallbackError, "cause", {
    value: fenceError,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return fallbackError;
}

function classifyMultipartWriterLeaseRenewalMismatch(
  renewal: Extract<
    MultipartMediaBlobWriterAttemptResult,
    Readonly<{ reservationToken: string }>
  >,
  writer: MultipartMediaBlobWriterAttemptExactInput,
): MultipartWriterLeaseRenewalOutcome {
  if (renewal.status !== "replayed") return renewal.status;
  const reservationMatches =
    renewal.reservationToken === writer.reservationToken;
  const normalizationMatches =
    renewal.normalizationVersion === writer.normalizationVersion;
  if (!reservationMatches && !normalizationMatches) {
    return "replayed_writer_mismatch";
  }
  if (!reservationMatches) return "replayed_reservation_mismatch";
  return "replayed_normalization_mismatch";
}

async function renewMultipartWriterLease(
  input: MultipartMediaBlobWriterAttemptInput,
  writer: MultipartMediaBlobWriterAttemptExactInput,
  writerLeaseTargetAtMs: number,
  operationDeadline: MultipartCompletionRequestDeadline,
  replayDatabaseCommit: MultipartDatabaseCommitReplay,
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettled:
    typeof beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwnerUntilSettled,
): Promise<MultipartWriterLease> {
  const renewal = await replayDatabaseCommit(
    () =>
      beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettled(
        input,
        writerLeaseTargetAtMs,
        operationDeadline.deadlineAtMs,
        operationDeadline.signal,
      ),
  );
  if (!("reservationToken" in renewal)) {
    const fallbackError = renewal.status === "completion_pending"
      ? createMultipartCompletionHandedOffError()
      : createMultipartAttemptError(
        renewal.status,
        "leaseExpiresAt" in renewal ? renewal.leaseExpiresAt : null,
      );
    throw new MultipartWriterLeaseRenewalRejectedError(
      renewal.status,
      fallbackError,
    );
  }
  if (
    renewal.status !== "replayed"
    || renewal.reservationToken !== writer.reservationToken
    || renewal.normalizationVersion !== writer.normalizationVersion
  ) {
    const durableOutcome = classifyMultipartWriterLeaseRenewalMismatch(
      renewal,
      writer,
    );
    throw new MultipartWriterLeaseRenewalRejectedError(
      durableOutcome,
      createMultipartWriterLeaseRenewalFenceFallback(),
    );
  }
  return {
    storageCapability: renewal.storageCapability,
    leaseExpiresAt: renewal.leaseExpiresAt,
  };
}

type MultipartWriterHeartbeat = Readonly<{
  signal: AbortSignal;
  getStorageCapability: () => Promise<MultipartMediaBlobStorageCapability>;
  assertStorageMutationAuthorized: () => void;
  renewNow: () => Promise<void>;
  stop: () => Promise<void>;
  stopAndRenewForFinalization: () => Promise<void>;
  getLastConfirmedLeaseExpiresAtMs: () => number;
  throwIfFailed: () => void;
}>;

function parseMultipartWriterLeaseExpiresAtMs(leaseExpiresAt: string): number {
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) {
    throw new TypeError(
      "Multipart writer lease did not include a valid expiry.",
    );
  }
  return leaseExpiresAtMs;
}

export function createMultipartWriterHeartbeat(
  initialLease: MultipartWriterLease,
  requestSignal: AbortSignal,
  operationDeadlineAtMs: number,
  writerLeaseTargetAtMs: number,
  leaseStorageAbortHeadroomMs: number,
  heartbeatIntervalMs: number,
  renewLease: () => Promise<MultipartWriterLease>,
): MultipartWriterHeartbeat {
  if (
    !Number.isSafeInteger(heartbeatIntervalMs)
    || heartbeatIntervalMs < 1
  ) {
    throw new RangeError(
      "Multipart writer heartbeat interval must be a positive integer.",
    );
  }
  if (
    !Number.isSafeInteger(operationDeadlineAtMs)
    || operationDeadlineAtMs < 1
    || !Number.isSafeInteger(writerLeaseTargetAtMs)
    || !Number.isSafeInteger(leaseStorageAbortHeadroomMs)
    || leaseStorageAbortHeadroomMs < 1
    || operationDeadlineAtMs >= writerLeaseTargetAtMs
    || writerLeaseTargetAtMs - operationDeadlineAtMs
      <= leaseStorageAbortHeadroomMs
  ) {
    throw new RangeError(
      "Multipart writer heartbeat requires a valid operation cutoff, absolute lease target, and storage-abort safety margin.",
    );
  }
  assertMultipartCompletionRequestActive(
    operationDeadlineAtMs,
    requestSignal,
  );
  const stopController = new AbortController();
  const failureController = new AbortController();
  const storageSignal = AbortSignal.any([
    requestSignal,
    failureController.signal,
  ]);
  const heartbeatWaitSignal = AbortSignal.any([
    requestSignal,
    stopController.signal,
    failureController.signal,
  ]);
  let latestLease = initialLease;
  let lastConfirmedLeaseExpiresAtMs =
    parseMultipartWriterLeaseExpiresAtMs(initialLease.leaseExpiresAt);
  let latestLeaseStorageAbortAtMs = 0;
  let leaseAbortTimer: NodeJS.Timeout | null = null;
  let renewalPromise: Promise<void> | null = null;
  let stopped = false;

  const fail = (error: unknown): void => {
    if (!failureController.signal.aborted) {
      failureController.abort(error);
    }
  };
  const failAndThrow = (error: unknown): never => {
    fail(error);
    storageSignal.throwIfAborted();
    throw new Error("Multipart writer heartbeat failure did not abort storage.");
  };
  const assertOperationActive = (): void => {
    storageSignal.throwIfAborted();
    if (Date.now() >= operationDeadlineAtMs) {
      failAndThrow(createMultipartCompletionDeadlineError());
    }
  };
  const assertStorageAuthorizationActive = (): void => {
    assertOperationActive();
    if (Date.now() >= latestLeaseStorageAbortAtMs) {
      failAndThrow(new MediaBlobWriterFenceError(
        "multipart_attempt_lease_storage_abort_deadline",
      ));
    }
  };
  const confirmLease = (lease: MultipartWriterLease): void => {
    assertOperationActive();
    const leaseExpiresAtMs = parseMultipartWriterLeaseExpiresAtMs(
      lease.leaseExpiresAt,
    );
    if (leaseExpiresAtMs >= writerLeaseTargetAtMs) {
      throw new MediaBlobWriterFenceError(
        "multipart_attempt_absolute_lease_target",
      );
    }
    const abortAtMs =
      leaseExpiresAtMs - leaseStorageAbortHeadroomMs;
    if (abortAtMs <= Date.now()) {
      throw new MediaBlobWriterFenceError(
        "multipart_attempt_lease_storage_abort_headroom",
      );
    }
    lastConfirmedLeaseExpiresAtMs = leaseExpiresAtMs;
    latestLeaseStorageAbortAtMs = abortAtMs;
    if (leaseAbortTimer !== null) clearTimeout(leaseAbortTimer);
    leaseAbortTimer = setTimeout(() => {
      fail(new MediaBlobWriterFenceError(
        "multipart_attempt_lease_storage_abort_deadline",
      ));
    }, abortAtMs - Date.now());
    leaseAbortTimer.unref();
    latestLease = lease;
  };
  confirmLease(initialLease);
  const renewNow = (): Promise<void> => {
    if (renewalPromise !== null) return renewalPromise;
    assertStorageAuthorizationActive();
    if (stopped) {
      throw new Error("Multipart writer heartbeat is already stopped.");
    }
    const operation = renewLease()
      .then((renewedLease) => {
        confirmLease(renewedLease);
        assertStorageAuthorizationActive();
      })
      .catch((error: unknown) => {
        fail(error);
        throw error;
      });
    renewalPromise = operation.finally(() => {
      renewalPromise = null;
    });
    return renewalPromise;
  };
  const loop = async (): Promise<void> => {
    try {
      while (!stopped) {
        try {
          await wait(
            heartbeatIntervalMs,
            undefined,
            { signal: heartbeatWaitSignal },
          );
        } catch (error) {
          if (stopped) return;
          if (requestSignal.aborted) requestSignal.throwIfAborted();
          throw error;
        }
        if (stopped) return;
        await renewNow();
      }
    } catch (error) {
      fail(error);
    }
  };
  const loopPromise = loop();
  const stop = async (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      stopController.abort();
    }
    await loopPromise;
    if (renewalPromise !== null) {
      await renewalPromise.catch(() => {});
    }
    if (leaseAbortTimer !== null) {
      clearTimeout(leaseAbortTimer);
      leaseAbortTimer = null;
    }
  };
  const stopAndRenewForFinalization = async (): Promise<void> => {
    await stop();
    assertOperationActive();
    try {
      confirmLease(await renewLease());
    } catch (error) {
      fail(error);
      throw error;
    }
    assertOperationActive();
  };

  return Object.freeze({
    signal: storageSignal,
    getStorageCapability: async () => {
      assertStorageAuthorizationActive();
      if (renewalPromise !== null) await renewalPromise;
      assertStorageAuthorizationActive();
      return latestLease.storageCapability;
    },
    assertStorageMutationAuthorized: assertStorageAuthorizationActive,
    renewNow,
    stop,
    stopAndRenewForFinalization,
    getLastConfirmedLeaseExpiresAtMs: () =>
      lastConfirmedLeaseExpiresAtMs,
    throwIfFailed: () => storageSignal.throwIfAborted(),
  });
}

async function beginUploadSessionAbort(
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

const multipartCompletionApplicationDependencies:
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

export function createMediaAssetsRoutes(options: MediaAssetsRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.route("/", createDirectImageIngestionRoutes(options));

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      const input = parseMediaAssetUploadSessionCreateInput(await parseJsonBody(context.req.raw));
      mediaAssetId = input.mediaAssetId;
      sessionId = randomUUID();
      const claimToken = randomUUID();
      const storageKey = buildMediaMultipartUploadStagingStorageKey(workspaceId, input.mediaAssetId, sessionId);
      const blobStorageKey = buildMediaBlobStorageKey(input.sha256);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const applicationResult =
        await createMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          workspaceId,
          sessionId,
          claimToken,
          input,
          storageKey,
          blobStorageKey,
          scope,
          context.req.raw.signal,
          multipartUploadSessionCreationClaimLeaseDurationMs,
          multipartUploadSessionCreationApplicationDependencies,
        );
      const sessionResult = applicationResult.sessionResult;
      if (sessionResult.status === "already_available") {
        addBackendBreadcrumb({
          action: applicationResult.multipartUploadCreated
            ? "media_asset_upload_session_concurrent_media_reuse"
            : "media_asset_upload_session_media_reuse",
          scope,
          details: {
            statusCode: 200,
            mediaAssetId: input.mediaAssetId,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            applied: sessionResult.applied,
          },
        });
        return context.json({
          workspaceId,
          mediaAssetId: input.mediaAssetId,
          status: "already_available",
          mediaAsset: sessionResult.mediaAsset,
          uploadSession: null,
        });
      }

      sessionId = sessionResult.uploadSession.sessionId;
      addBackendBreadcrumb({
        action: "media_asset_upload_session_create",
        scope,
        details: {
          statusCode: 201,
          mediaAssetId: input.mediaAssetId,
          sessionId,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          partSizeBytes: input.partSizeBytes,
          partCount: input.partCount,
        },
      });
      return context.json({
        workspaceId,
        mediaAssetId: input.mediaAssetId,
        status: "upload_required",
        mediaAsset: null,
        uploadSession: {
          sessionId: sessionResult.uploadSession.sessionId,
          expiresAt: sessionResult.uploadSession.expiresAt,
          partSizeBytes: sessionResult.uploadSession.partSizeBytes,
          partCount: sessionResult.uploadSession.partCount,
        },
      }, 201);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/parts", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const input = parseMediaAssetUploadSessionPartUrlsInput(await parseJsonBody(context.req.raw));
      const session = await loadMediaAssetUploadSessionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      if (isMediaAssetUploadSessionExpired(session)) {
        const expiry = await beginUploadSessionAbort(
          loadedContext.requestContext.userId,
          workspaceId,
          sessionId,
          runDatabaseOperationOnce,
        );
        await abortMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          expiry,
          scope,
          context.req.raw.signal,
          runDatabaseOperationOnce,
          abortMultipartMediaAssetUpload,
        );
        throw createUploadSessionExpiredError(session);
      }
      assertMediaAssetUploadSessionPartNumbersInRange(session, input.parts);
      const partUrls = await createPresignedMediaAssetUploadParts({
        workspaceId,
        mediaAssetId: session.mediaAssetId,
        stagingStorageKey: session.stagingStorageKey,
        s3UploadId: session.s3UploadId,
        parts: input.parts,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_upload_session_part_urls_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
          partCount: input.parts.length,
        },
      });
      return context.json({ sessionId, partUrls });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_part_urls_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_part_urls_create_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete", async (context) => {
    const observedAtMs = Date.now();
    const timingContext = getMultipartCompletionRequestTimingContext();
    const requestTiming = timingContext === null
      ? createStandaloneMultipartCompletionRequestTiming(observedAtMs)
      : timingContext.timing;
    const requestDeadlineAtMs =
      requestTiming?.requestDeadlineAtMs ?? observedAtMs;
    const operationDeadlineAtMs =
      requestTiming?.operationDeadlineAtMs ?? observedAtMs;
    const writerLeaseTargetAtMs =
      requestTiming?.writerLeaseTargetAtMs ?? observedAtMs;
    const requestDeadline =
      createMultipartCompletionRequestDeadline(requestDeadlineAtMs);
    const operationDeadline =
      createMultipartCompletionRequestDeadline(operationDeadlineAtMs);
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      if (
        requestTiming === null
        || observedAtMs >= requestTiming.acquisitionDeadlineAtMs
        || observedAtMs >= requestTiming.integrationDeadlineAtMs
      ) {
        throw createMultipartCompletionDeadlineError();
      }
      return await runDatabaseOperationsWithDeadline(
        requestDeadlineAtMs,
        async () => {
          const prepared = await runDatabaseOperationsWithDeadline(
            operationDeadlineAtMs,
            async () => {
              const loadedContext =
                await loadRequestContextFromRequestWithAbortSignal(
                  context.req.raw,
                  options.allowedOrigins,
                  operationDeadline.signal,
                );
              requestContext = loadedContext.requestContext;
              const parsedWorkspaceId = parseWorkspaceIdParam(
                context.req.param("workspaceId"),
              );
              workspaceId = parsedWorkspaceId;
              await assertUserHasWorkspaceAccess(
                loadedContext.requestContext.userId,
                parsedWorkspaceId,
              );
              const parsedSessionId = parseMediaAssetUploadSessionIdParam(
                context.req.param("sessionId"),
              );
              sessionId = parsedSessionId;
              const input = parseCompleteMediaAssetUploadSessionInput(
                await parseJsonBody(context.req.raw),
              );
              const session =
                await loadMediaAssetUploadSessionForCompletionForWorkspace(
                  loadedContext.requestContext.userId,
                  parsedWorkspaceId,
                  parsedSessionId,
                );
              return {
                loadedContext,
                input,
                session,
                workspaceId: parsedWorkspaceId,
                sessionId: parsedSessionId,
              };
            },
          );
          const {
            loadedContext,
            input,
            session,
            workspaceId: preparedWorkspaceId,
            sessionId: preparedSessionId,
          } = prepared;
          mediaAssetId = session.mediaAssetId;
          const scope = createMediaAssetsScope(
            requestId,
            context.req.path,
            context.req.method,
            loadedContext.requestContext.userId,
            preparedWorkspaceId,
            context.get("clientAppVersion"),
            context.get("clientPlatform"),
          );
          const result =
            await completeMultipartUploadSessionAtApplicationBoundary(
              loadedContext.requestContext.userId,
              session,
              input.parts,
              randomUUID(),
              scope,
              operationDeadline,
              writerLeaseTargetAtMs,
              requestDeadline,
              multipartCompletionApplicationDependencies,
            );

          addBackendBreadcrumb({
            action: "media_asset_upload_session_complete",
            scope,
            details: {
              statusCode: 200,
              mediaAssetId: session.mediaAssetId,
              sessionId: preparedSessionId,
              mimeType: session.mimeType,
              sizeBytes: session.sizeBytes,
              applied: result.applied,
            },
          });
          return context.json(result);
        },
      );
    } catch (error) {
      const mappedError = mapMultipartCompletionDeadlineError(
        error,
        operationDeadline,
        requestDeadline,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(mappedError),
      };
      reportBackendExceptionOrBreadcrumb(
        mappedError,
        { action: "media_asset_upload_session_complete_error", error: normalizeCaughtError(mappedError), scope, details },
        { action: "media_asset_upload_session_complete_error", scope, details },
      );
      throw mappedError;
    } finally {
      operationDeadline.dispose();
      requestDeadline.dispose();
    }
  });

  app.post("/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/abort", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;
    let sessionId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      sessionId = parseMediaAssetUploadSessionIdParam(context.req.param("sessionId"));
      const abortStart = await beginUploadSessionAbort(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
        runDatabaseOperationOnce,
      );
      const session = abortStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const abortedSession =
        await abortMultipartUploadSessionAtApplicationBoundary(
          loadedContext.requestContext.userId,
          abortStart,
          scope,
          context.req.raw.signal,
          runDatabaseOperationOnce,
          abortMultipartMediaAssetUpload,
        );

      addBackendBreadcrumb({
        action: "media_asset_upload_session_abort",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
        },
      });
      return context.json({ sessionId, abortedAt: abortedSession.abortedAt });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_abort_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_abort_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const mediaAsset = await loadMediaAssetForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      addBackendBreadcrumb({
        action: "media_asset_get",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
        },
      });
      return context.json({ mediaAsset });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_get_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_get_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/media-assets/:mediaAssetId/download-url", async (context) => {
    const requestId = context.get("requestId");
    let requestContext: RequestContext | null = null;
    let workspaceId: string | null = null;
    let mediaAssetId: string | null = null;

    try {
      const loadedContext = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      requestContext = loadedContext.requestContext;
      workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(loadedContext.requestContext.userId, workspaceId);
      mediaAssetId = parseMediaAssetIdParam(context.req.param("mediaAssetId"));
      const { mediaAsset, mediaBlob } = await loadMediaAssetWithBlobForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        mediaAssetId,
      );
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const download = await createPresignedMediaAssetDownload({
        workspaceId,
        mediaAssetId,
        storageKey: mediaBlob.storageKey,
        observationScope: scope,
      });

      addBackendBreadcrumb({
        action: "media_asset_download_url_create",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId,
        },
      });
      return context.json({ mediaAsset, download });
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_download_url_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_download_url_create_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
