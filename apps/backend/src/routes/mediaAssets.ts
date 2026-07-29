import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { Hono } from "hono";
import {
  loadMediaAssetForWorkspace,
  loadMediaAssetWithBlobForWorkspace,
} from "../mediaAssets";
import {
  assertMediaAssetUploadSessionPartNumbersInRange,
  acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionForWorkspace,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetFromAvailableBlobForWorkspace,
  loadMediaAssetUploadSessionCreationReplayForWorkspace,
  loadMediaAssetUploadSessionForWorkspace,
  markMediaAssetUploadSessionAbortedForWorkspace,
  recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  recoverMediaAssetUploadSessionCompletionForWorkspace,
  releaseMediaAssetUploadSessionCreationClaimForWorkspace,
  type MediaAssetUploadSessionCreationClaimResult,
  type MediaAssetUploadSessionCreationReplayResult,
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
  parseWorkspaceIdParam,
  type RequestContext,
} from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import { runDatabaseOperationsWithDeadline } from "../database";
import { DatabaseCommitOutcomeUnknownError } from "../database/transient";
import type {
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionCreateResult,
} from "../mediaAssets/types";
import { createDirectImageIngestionRoutes } from "./directImageIngestion";

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

function getFailureStatusCode(error: unknown): number {
  return error instanceof HttpError ? error.statusCode : 500;
}

function getFailureCode(error: unknown): string {
  if (error instanceof HttpError) {
    return error.code ?? "HTTP_ERROR";
  }

  return "INTERNAL_ERROR";
}

function createUploadSessionCompletionRecoveryError(
  completionError: unknown,
  recoveryError: unknown,
  workspaceId: string,
  sessionId: string,
): HttpError {
  return new HttpError(
    500,
    [
      "Media asset upload completion failed and the upload session could not be restored for retry",
      `workspaceId=${workspaceId}`,
      `sessionId=${sessionId}`,
      `completionStatusCode=${getFailureStatusCode(completionError)}`,
      `completionCode=${getFailureCode(completionError)}`,
      `recoveryStatusCode=${getFailureStatusCode(recoveryError)}`,
      `recoveryCode=${getFailureCode(recoveryError)}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_SESSION_RECOVERY_FAILED",
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
      assertMediaAssetUploadSessionPartNumbersInRange(session, input.parts);
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
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
      const input = parseCompleteMediaAssetUploadSessionInput(await parseJsonBody(context.req.raw));
      const completionStart = await beginMediaAssetUploadSessionCompletionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
        input.parts,
      );
      if (completionStart.status === "already_completed") {
        return context.json({
          mediaAsset: completionStart.mediaAsset,
          applied: completionStart.applied,
        });
      }

      const session = completionStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));

      try {
        await completeMultipartMediaAssetUpload({
          workspaceId,
          mediaAssetId: session.mediaAssetId,
          stagingStorageKey: session.stagingStorageKey,
          blobStorageKey: session.blobStorageKey,
          s3UploadId: session.s3UploadId,
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes,
          sha256: session.mediaBlobSha256,
          lastOperationId: session.lastOperationId,
          parts: input.parts,
          observationScope: scope,
        });
      } catch (completionError) {
        try {
          await recoverMediaAssetUploadSessionCompletionForWorkspace(
            loadedContext.requestContext.userId,
            workspaceId,
            sessionId,
          );
        } catch (recoveryError) {
          throw createUploadSessionCompletionRecoveryError(
            completionError,
            recoveryError,
            workspaceId,
            sessionId,
          );
        }

        throw completionError;
      }
      const result = await completeMediaAssetUploadSessionForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );

      addBackendBreadcrumb({
        action: "media_asset_upload_session_complete",
        scope,
        details: {
          statusCode: 200,
          mediaAssetId: session.mediaAssetId,
          sessionId,
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes,
          applied: result.applied,
        },
      });
      return context.json(result);
    } catch (error) {
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, getRequestContextUserId(requestContext), workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      const details = {
        mediaAssetId,
        sessionId,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "media_asset_upload_session_complete_error", error: normalizeCaughtError(error), scope, details },
        { action: "media_asset_upload_session_complete_error", scope, details },
      );
      throw error;
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
      const abortStart = await beginMediaAssetUploadSessionAbortForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
      );
      if (abortStart.status === "already_aborted") {
        return context.json({ sessionId, abortedAt: abortStart.uploadSession.abortedAt });
      }

      const session = abortStart.uploadSession;
      mediaAssetId = session.mediaAssetId;
      const scope = createMediaAssetsScope(requestId, context.req.path, context.req.method, loadedContext.requestContext.userId, workspaceId, context.get("clientAppVersion"), context.get("clientPlatform"));
      await abortMultipartMediaAssetUpload({
        workspaceId,
        mediaAssetId: session.mediaAssetId,
        stagingStorageKey: session.stagingStorageKey,
        s3UploadId: session.s3UploadId,
        observationScope: scope,
      });
      const abortedSession = await markMediaAssetUploadSessionAbortedForWorkspace(
        loadedContext.requestContext.userId,
        workspaceId,
        sessionId,
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
