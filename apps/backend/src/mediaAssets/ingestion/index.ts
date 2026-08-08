import { createHash, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import {
  applyImageNormalizedMediaAssetWithDirectWriterForWorkspace,
  loadReusableImageMediaBlobForWorkspace,
  replayImageNormalizedMediaAssetForWorkspace,
} from "..";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import type { BackendObservationScope } from "../../observability/sentry/events";
import { HttpError } from "../../shared/errors";
import {
  beginDirectMediaBlobWriterAttemptWithOwner,
  mediaBlobCleanupDelayMs,
  MediaBlobLifecycleBusyError,
  MediaBlobWriterLeaseDeadlineError,
  MediaBlobWriterOperationDeadlineExpiredError,
  MediaBlobWriterFenceError,
  resolveDirectMediaBlobWriterAttemptAfterAccessRevocation,
  resolveDirectMediaBlobWriterAttemptFailureWithOwner,
  type DirectMediaBlobStorageCapability,
  type DirectMediaBlobWriterAttemptExactInput,
  type DirectMediaBlobWriterAttemptFailureStatus,
  type DirectMediaBlobWriterAttemptInput,
  type DirectMediaBlobWriterAttemptResult,
  type DirectMediaBlobWriterAttemptRevocationStatus,
} from "../blobLifecycle";
import { storeMediaAssetBlobBytesIfAbsent } from "../storage/direct";
import { buildMediaBlobStorageKey } from "../storageKeys";
import {
  imageJpegCardMediaBlobNormalizationVersion,
  type MediaAsset,
  type MediaAssetImageIngestionMetadataInput,
  type NormalizedImageMediaAssetInput,
} from "../types";
import {
  normalizeImageBytesForCardUntilDeadline,
  type NormalizedImageBytes,
} from "./imageNormalization";
import {
  createStandaloneDirectImageIngestionRequestTiming,
  directImageIngestionMinimumAcquisitionBudgetMs,
  directImageIngestionRequestBudgetMs,
  directImageIngestionResponseMarginMs,
  publicRestApiIntegrationTimeoutMs,
  type DirectImageIngestionRequestTiming,
} from "../../server/mediaRequests/directImageIngestionRequestTiming";

export {
  directImageIngestionMinimumAcquisitionBudgetMs,
  directImageIngestionRequestBudgetMs,
} from "../../server/mediaRequests/directImageIngestionRequestTiming";

export const directImageIngestionWorkCompletionMarginMs = 4_000;
export const directImageIngestionLeaseTerminalMarginMs = 2_000;
const directImageIngestionMinimumStorageAndApplyBudgetMs = 6_000;
const directImageIngestionMinimumApplyBudgetMs = 1_500;
const directImageIngestionMinimumTerminalizationBudgetMs = 1_000;
const directImageIngestionLeaseExpiryPaddingMs = 100;

export type DirectImageIngestionAbortHandle = Readonly<{
  signal: AbortSignal;
  dispose: () => void;
}>;

export type DirectImageIngestionRequestDeadline = Readonly<{
  requestDeadlineAtMs: number;
  preprocessingDeadlineAtMs: number;
  requestSignal: AbortSignal;
  preprocessingSignal: AbortSignal;
  getRemainingInvocationTimeMs: () => number;
  disposePreprocessing: () => void;
  dispose: () => void;
}>;

export type ImageMediaAssetIngestionInput = Readonly<{
  userId: string;
  workspaceId: string;
  metadata: MediaAssetImageIngestionMetadataInput;
  imageBytes: Buffer;
  observationScope: BackendObservationScope;
}>;

export type ImageMediaAssetIngestionResult = Readonly<{
  mediaAsset: MediaAsset;
  applied: boolean;
}>;

type DirectImageIngestionDeadline = Readonly<{
  requestDeadlineAtMs: number;
  requestDeadlineAt: string;
  operationDeadlineAtMs: number;
  operationDeadlineAt: string;
  leaseTargetAtMs: number;
  requestSignal: AbortSignal;
  storageSignal: AbortSignal;
  getRemainingInvocationTimeMs: () => number;
  dispose: () => void;
}>;

type DirectWriterLease = Readonly<{
  leaseExpiresAt: string;
  storageCapability: DirectMediaBlobStorageCapability;
}>;

type DirectWriterStatus =
  | DirectMediaBlobWriterAttemptResult["status"]
  | DirectMediaBlobWriterAttemptFailureStatus
  | DirectMediaBlobWriterAttemptRevocationStatus
  | "ready";

export type ImageMediaAssetIngestionDependencies = Readonly<{
  createAttemptTokenFn: () => string;
  createAbortHandleFn: (
    deadlineAtMs: number,
    phase: string,
  ) => DirectImageIngestionAbortHandle;
  nowFn: () => number;
  normalizeImageBytesForCardFn: (
    inputBytes: Buffer,
    deadlineAtMs: number,
    signal: AbortSignal,
  ) => Promise<NormalizedImageBytes>;
  waitForWriterLeaseExpiryFn: (
    leaseExpiresAt: string,
    requestDeadlineAtMs: number,
    signal: AbortSignal,
    getRemainingInvocationTimeMs: () => number,
  ) => Promise<void>;
  beginDirectMediaBlobWriterAttemptWithOwnerFn:
    typeof beginDirectMediaBlobWriterAttemptWithOwner;
  resolveDirectMediaBlobWriterAttemptAfterAccessRevocationFn:
    typeof resolveDirectMediaBlobWriterAttemptAfterAccessRevocation;
  resolveDirectMediaBlobWriterAttemptFailureWithOwnerFn:
    typeof resolveDirectMediaBlobWriterAttemptFailureWithOwner;
  loadReusableImageMediaBlobForWorkspaceFn: typeof loadReusableImageMediaBlobForWorkspace;
  replayImageNormalizedMediaAssetForWorkspaceFn:
    typeof replayImageNormalizedMediaAssetForWorkspace;
  storeMediaAssetBlobBytesIfAbsentFn: typeof storeMediaAssetBlobBytesIfAbsent;
  applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn:
    typeof applyImageNormalizedMediaAssetWithDirectWriterForWorkspace;
}>;

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toNormalizedImageMediaAssetInput(
  metadata: MediaAssetImageIngestionMetadataInput,
  normalizedImage: NormalizedImageBytes,
): NormalizedImageMediaAssetInput {
  return {
    mediaAssetId: metadata.mediaAssetId,
    sourceUrl: metadata.sourceUrl,
    createdAt: metadata.createdAt,
    clientUpdatedAt: metadata.clientUpdatedAt,
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    lastOperationId: metadata.lastOperationId,
    sizeBytes: normalizedImage.sizeBytes,
    sha256: sha256Hex(normalizedImage.bytes),
  };
}

export function createDirectImageIngestionDeadlineError(phase: string): HttpError {
  return new HttpError(
    503,
    `Media image ingestion cannot safely finish within its request deadline. phase=${phase}`,
    "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
}

function createDirectImageIngestionAbortHandle(
  deadlineAtMs: number,
  phase: string,
): DirectImageIngestionAbortHandle {
  const controller = new AbortController();
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    controller.abort(createDirectImageIngestionDeadlineError(phase));
    return Object.freeze({
      signal: controller.signal,
      dispose: () => {},
    });
  }
  const timer = setTimeout(
    () => controller.abort(createDirectImageIngestionDeadlineError(phase)),
    remainingMs,
  );
  timer.unref();
  return Object.freeze({
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  });
}

export function createDirectImageIngestionRequestDeadline(
  timing: DirectImageIngestionRequestTiming,
): DirectImageIngestionRequestDeadline {
  const requestDeadlineAtMs = timing.requestDeadlineAtMs;
  const preprocessingDeadlineAtMs = timing.preprocessingDeadlineAtMs;
  const requestAbort = createDirectImageIngestionAbortHandle(
    requestDeadlineAtMs,
    "request",
  );
  const preprocessingAbort = createDirectImageIngestionAbortHandle(
    preprocessingDeadlineAtMs,
    "preprocessing",
  );
  return Object.freeze({
    requestDeadlineAtMs,
    preprocessingDeadlineAtMs,
    requestSignal: requestAbort.signal,
    preprocessingSignal: preprocessingAbort.signal,
    getRemainingInvocationTimeMs: timing.getRemainingInvocationTimeMs,
    disposePreprocessing: preprocessingAbort.dispose,
    dispose: () => {
      preprocessingAbort.dispose();
      requestAbort.dispose();
    },
  });
}

function createDirectImageIngestionDeadline(
  requestDeadline: DirectImageIngestionRequestDeadline,
  nowMs: number,
  createAbortHandleFn: ImageMediaAssetIngestionDependencies["createAbortHandleFn"],
): DirectImageIngestionDeadline {
  const requestDeadlineAtMs = requestDeadline.requestDeadlineAtMs;
  const operationDeadlineAtMs =
    requestDeadlineAtMs - directImageIngestionWorkCompletionMarginMs;
  const leaseTargetAtMs =
    requestDeadlineAtMs - directImageIngestionLeaseTerminalMarginMs;
  if (
    directImageIngestionRequestBudgetMs >= publicRestApiIntegrationTimeoutMs
    || operationDeadlineAtMs >= leaseTargetAtMs
    || requestDeadline.preprocessingDeadlineAtMs
      !== requestDeadlineAtMs - directImageIngestionMinimumAcquisitionBudgetMs
    || requestDeadlineAtMs - nowMs > directImageIngestionRequestBudgetMs
  ) {
    throw new Error("Direct image ingestion deadline margins are invalid.");
  }
  const operationAbort = createAbortHandleFn(
    operationDeadlineAtMs,
    "storage_and_apply",
  );
  return Object.freeze({
    requestDeadlineAtMs,
    requestDeadlineAt: new Date(requestDeadlineAtMs).toISOString(),
    operationDeadlineAtMs,
    operationDeadlineAt: new Date(operationDeadlineAtMs).toISOString(),
    leaseTargetAtMs,
    requestSignal: requestDeadline.requestSignal,
    storageSignal: operationAbort.signal,
    getRemainingInvocationTimeMs:
      requestDeadline.getRemainingInvocationTimeMs,
    dispose: operationAbort.dispose,
  });
}

function assertRemainingBudget(
  deadlineAtMs: number,
  minimumRemainingMs: number,
  nowMs: number,
  phase: string,
  getRemainingInvocationTimeMs: () => number,
): void {
  const remainingInvocationTimeMs = getRemainingInvocationTimeMs();
  if (
    !Number.isFinite(nowMs)
    || deadlineAtMs - nowMs <= minimumRemainingMs
    || !Number.isSafeInteger(remainingInvocationTimeMs)
    || remainingInvocationTimeMs
      - directImageIngestionResponseMarginMs <= minimumRemainingMs
  ) {
    throw createDirectImageIngestionDeadlineError(phase);
  }
}

function hasSqlState(error: unknown, sqlState: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === sqlState;
}

async function replayCommitUnknown<Result>(
  operation: () => Promise<Result>,
  requestDeadlineAtMs: number,
  nowFn: () => number,
  getRemainingInvocationTimeMs: () => number,
): Promise<Result> {
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DatabaseCommitOutcomeUnknownError)) {
        throw error;
      }
      assertRemainingBudget(
        requestDeadlineAtMs,
        directImageIngestionMinimumTerminalizationBudgetMs,
        nowFn(),
        "database_commit_replay",
        getRemainingInvocationTimeMs,
      );
    }
  }
}

async function beginDirectWriter(
  input: DirectMediaBlobWriterAttemptInput,
  deadline: DirectImageIngestionDeadline,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<DirectMediaBlobWriterAttemptResult> {
  try {
    assertRemainingBudget(
      deadline.requestDeadlineAtMs,
      0,
      dependencies.nowFn(),
      "before_writer_mutation",
      deadline.getRemainingInvocationTimeMs,
    );
    return await replayCommitUnknown(
      () => dependencies.beginDirectMediaBlobWriterAttemptWithOwnerFn(
        input,
        {
          leaseTargetAt: new Date(deadline.leaseTargetAtMs).toISOString(),
          operationDeadlineAt: deadline.operationDeadlineAt,
        },
      ),
      deadline.requestDeadlineAtMs,
      dependencies.nowFn,
      deadline.getRemainingInvocationTimeMs,
    );
  } catch (error) {
    if (error instanceof MediaBlobWriterLeaseDeadlineError) {
      throw createDirectImageIngestionDeadlineError("writer_lease");
    }
    if (!hasSqlState(error, "42501")) throw error;
    throw new HttpError(
      403,
      "Workspace access changed during media ingestion.",
      "WORKSPACE_ACCESS_DENIED",
    );
  }
}

function assertDirectWriterLeaseWithinDeadline(
  lease: DirectWriterLease,
  deadline: DirectImageIngestionDeadline,
): void {
  const leaseExpiresAtMs = Date.parse(lease.leaseExpiresAt);
  if (
    !Number.isFinite(leaseExpiresAtMs)
    || leaseExpiresAtMs <= deadline.operationDeadlineAtMs
    || leaseExpiresAtMs > deadline.leaseTargetAtMs
  ) {
    throw createDirectImageIngestionDeadlineError("writer_lease");
  }
}

async function renewDirectWriterLease(
  input: DirectMediaBlobWriterAttemptInput,
  writer: DirectMediaBlobWriterAttemptExactInput,
  deadline: DirectImageIngestionDeadline,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<DirectWriterLease> {
  const renewal = await beginDirectWriter(input, deadline, dependencies);
  if (!("reservationToken" in renewal)) {
    throwDirectAttemptStatus(
      renewal.status,
      "leaseExpiresAt" in renewal ? renewal.leaseExpiresAt : null,
      deadline,
      dependencies.nowFn(),
    );
  }
  if (
    renewal.status !== "replayed"
    || renewal.reservationToken !== writer.reservationToken
    || renewal.normalizationVersion !== writer.normalizationVersion
  ) {
    throw new MediaBlobWriterFenceError("direct_attempt_renewal");
  }
  const lease = {
    leaseExpiresAt: renewal.leaseExpiresAt,
    storageCapability: renewal.storageCapability,
  };
  assertDirectWriterLeaseWithinDeadline(lease, deadline);
  return lease;
}

async function waitForWriterLeaseExpiry(
  leaseExpiresAt: string,
  requestDeadlineAtMs: number,
  signal: AbortSignal,
  getRemainingInvocationTimeMs: () => number,
): Promise<void> {
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  const nowMs = Date.now();
  if (!Number.isFinite(leaseExpiresAtMs)) {
    throw new MediaBlobWriterFenceError("direct_attempt_lease_expiry");
  }
  const waitMs = Math.max(
    directImageIngestionLeaseExpiryPaddingMs,
    leaseExpiresAtMs - nowMs + directImageIngestionLeaseExpiryPaddingMs,
  );
  assertRemainingBudget(
    requestDeadlineAtMs,
    waitMs + directImageIngestionMinimumTerminalizationBudgetMs,
    nowMs,
    "revoked_writer_wait",
    getRemainingInvocationTimeMs,
  );
  try {
    await wait(waitMs, undefined, { signal });
  } catch (error) {
    if (signal.aborted) {
      throw createDirectImageIngestionDeadlineError("revoked_writer_wait");
    }
    throw error;
  }
}

function throwDirectAttemptStatus(
  status: DirectWriterStatus,
  leaseExpiresAt: string | null,
  deadline: DirectImageIngestionDeadline,
  nowMs: number,
): never {
  if (status === "cleanup_claimed") throw new MediaBlobLifecycleBusyError();
  if (status === "access_denied") {
    throw new HttpError(
      403,
      "Workspace access changed during media ingestion.",
      "WORKSPACE_ACCESS_DENIED",
    );
  }
  if (status === "replica_mismatch") {
    throw new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica accessible to the authenticated user.",
      "MEDIA_ASSET_REPLICA_INVALID",
    );
  }
  if (status === "ready" || status === "access_active") {
    throw new MediaBlobWriterFenceError(`direct_attempt_${status}`);
  }
  if (status === "busy") {
    const leaseExpiresAtMs = leaseExpiresAt === null
      ? Number.NaN
      : Date.parse(leaseExpiresAt);
    if (!Number.isFinite(leaseExpiresAtMs)) {
      throw new MediaBlobWriterFenceError("direct_attempt_busy_lease");
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.min(
        60,
        Math.ceil(
          (Math.min(leaseExpiresAtMs, deadline.requestDeadlineAtMs) - nowMs)
          / 1_000,
        ),
      ),
    );
    throw new HttpError(
      409,
      "Media ingestion is already in progress. Retry after the active writer lease expires.",
      "MEDIA_ASSET_WRITER_BUSY",
      { retryAfterSeconds },
    );
  }
  throw new HttpError(
    409,
    `Media ingestion conflicts with its current writer state. status=${status}`,
    "MEDIA_ASSET_ID_CONFLICT",
  );
}

async function resolveDirectWriterAfterRevocation(
  writer: DirectMediaBlobWriterAttemptExactInput,
  leaseExpiresAt: string,
  deadline: DirectImageIngestionDeadline,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<DirectMediaBlobWriterAttemptRevocationStatus> {
  const resolve = (): Promise<DirectMediaBlobWriterAttemptRevocationStatus> =>
    replayCommitUnknown(
      () => dependencies.resolveDirectMediaBlobWriterAttemptAfterAccessRevocationFn(
        writer,
        mediaBlobCleanupDelayMs,
        deadline.requestDeadlineAt,
      ),
      deadline.requestDeadlineAtMs,
      dependencies.nowFn,
      deadline.getRemainingInvocationTimeMs,
    );
  const initialResolution = await resolve();
  if (initialResolution !== "busy") {
    return initialResolution;
  }
  await dependencies.waitForWriterLeaseExpiryFn(
    leaseExpiresAt,
    deadline.requestDeadlineAtMs,
    deadline.requestSignal,
    deadline.getRemainingInvocationTimeMs,
  );
  const replayedResolution = await resolve();
  if (replayedResolution === "busy") {
    throw new MediaBlobWriterFenceError("revoked_writer_busy_after_lease_expiry");
  }
  return replayedResolution;
}

async function resolveDirectWriterFailureWithCurrentAccess(
  writer: DirectMediaBlobWriterAttemptExactInput,
  deadline: DirectImageIngestionDeadline,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<DirectMediaBlobWriterAttemptFailureStatus> {
  try {
    return await replayCommitUnknown(
      () => dependencies.resolveDirectMediaBlobWriterAttemptFailureWithOwnerFn(
        writer,
        mediaBlobCleanupDelayMs,
        deadline.requestDeadlineAt,
      ),
      deadline.requestDeadlineAtMs,
      dependencies.nowFn,
      deadline.getRemainingInvocationTimeMs,
    );
  } catch (error) {
    if (hasSqlState(error, "42501")) return "access_denied";
    throw error;
  }
}

async function resolveDirectWriterFailure(
  writer: DirectMediaBlobWriterAttemptExactInput,
  leaseExpiresAt: string,
  deadline: DirectImageIngestionDeadline,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<DirectWriterStatus> {
  let resolution = await resolveDirectWriterFailureWithCurrentAccess(
    writer,
    deadline,
    dependencies,
  );
  if (resolution !== "access_denied") return resolution;
  const revokedResolution = await resolveDirectWriterAfterRevocation(
    writer,
    leaseExpiresAt,
    deadline,
    dependencies,
  );
  if (revokedResolution !== "access_active") return revokedResolution;
  resolution = await resolveDirectWriterFailureWithCurrentAccess(
    writer,
    deadline,
    dependencies,
  );
  if (resolution !== "access_denied") return resolution;
  return resolveDirectWriterAfterRevocation(
    writer,
    leaseExpiresAt,
    deadline,
    dependencies,
  );
}

function isReplayedApplyStatus(
  status: DirectWriterStatus,
): status is "already_applied" | "live_applied" | "referenced" | "peer_conflict" {
  return status === "already_applied"
    || status === "live_applied"
    || status === "referenced"
    || status === "peer_conflict";
}

export async function ingestImageMediaAssetWithDependencies(
  input: ImageMediaAssetIngestionInput,
  requestDeadline: DirectImageIngestionRequestDeadline,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<ImageMediaAssetIngestionResult> {
  const deadline = createDirectImageIngestionDeadline(
    requestDeadline,
    dependencies.nowFn(),
    dependencies.createAbortHandleFn,
  );
  try {
    assertRemainingBudget(
      requestDeadline.preprocessingDeadlineAtMs,
      0,
      dependencies.nowFn(),
      "before_preprocessing",
      requestDeadline.getRemainingInvocationTimeMs,
    );
    requestDeadline.preprocessingSignal.throwIfAborted();
    const normalizedImage = await dependencies.normalizeImageBytesForCardFn(
      input.imageBytes,
      requestDeadline.preprocessingDeadlineAtMs,
      requestDeadline.preprocessingSignal,
    );
    requestDeadline.disposePreprocessing();
    const normalizedInput = toNormalizedImageMediaAssetInput(input.metadata, normalizedImage);
    assertRemainingBudget(
      deadline.requestDeadlineAtMs,
      directImageIngestionMinimumAcquisitionBudgetMs,
      dependencies.nowFn(),
      "before_acquisition",
      deadline.getRemainingInvocationTimeMs,
    );
    const attemptInput: DirectMediaBlobWriterAttemptInput = {
      attemptToken: dependencies.createAttemptTokenFn(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      mediaAssetId: normalizedInput.mediaAssetId,
      operationId: normalizedInput.lastOperationId,
      lastModifiedByReplicaId: normalizedInput.lastModifiedByReplicaId,
      sha256: normalizedInput.sha256,
      storageKey: buildMediaBlobStorageKey(normalizedInput.sha256),
      mimeType: normalizedImage.mimeType,
      sizeBytes: normalizedInput.sizeBytes,
      normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
      sourceUrl: normalizedInput.sourceUrl,
      assetCreatedAt: normalizedInput.createdAt,
      clientUpdatedAt: normalizedInput.clientUpdatedAt,
    };
    let attempt: DirectMediaBlobWriterAttemptResult;
    try {
      attempt = await beginDirectWriter(attemptInput, deadline, dependencies);
    } catch (error) {
      if (error instanceof MediaBlobWriterOperationDeadlineExpiredError) {
        throw createDirectImageIngestionDeadlineError("acquisition");
      }
      throw error;
    }
    if (!("reservationToken" in attempt)) {
      if (isReplayedApplyStatus(attempt.status)) {
        return dependencies.replayImageNormalizedMediaAssetForWorkspaceFn(
          input.userId,
          input.workspaceId,
          normalizedInput,
          attempt.status,
          deadline.requestDeadlineAtMs,
        );
      }
      throwDirectAttemptStatus(
        attempt.status,
        "leaseExpiresAt" in attempt ? attempt.leaseExpiresAt : null,
        deadline,
        dependencies.nowFn(),
      );
    }
    const writer: DirectMediaBlobWriterAttemptExactInput = {
      ...attemptInput,
      reservationToken: attempt.reservationToken,
      normalizationVersion: attempt.normalizationVersion,
    };
    let lease: DirectWriterLease = {
      leaseExpiresAt: attempt.leaseExpiresAt,
      storageCapability: attempt.storageCapability,
    };

    try {
      assertDirectWriterLeaseWithinDeadline(lease, deadline);
      const reusableBlob = await dependencies.loadReusableImageMediaBlobForWorkspaceFn(
        input.userId,
        input.workspaceId,
        normalizedInput,
        deadline.operationDeadlineAtMs,
      );
      if (reusableBlob === null) {
        lease = await renewDirectWriterLease(
          attemptInput,
          writer,
          deadline,
          dependencies,
        );
        assertRemainingBudget(
          deadline.operationDeadlineAtMs,
          directImageIngestionMinimumStorageAndApplyBudgetMs,
          dependencies.nowFn(),
          "before_storage",
          deadline.getRemainingInvocationTimeMs,
        );
        await dependencies.storeMediaAssetBlobBytesIfAbsentFn({
          writer,
          storageCapability: lease.storageCapability,
          signal: deadline.storageSignal,
          workspaceId: input.workspaceId,
          mediaAssetId: normalizedInput.mediaAssetId,
          storageKey: attemptInput.storageKey,
          mimeType: normalizedImage.mimeType,
          sha256: normalizedInput.sha256,
          lastOperationId: normalizedInput.lastOperationId,
          bytes: normalizedImage.bytes,
          observationScope: input.observationScope,
        });
      }
      lease = await renewDirectWriterLease(
        attemptInput,
        writer,
        deadline,
        dependencies,
      );
      assertRemainingBudget(
        deadline.operationDeadlineAtMs,
        directImageIngestionMinimumApplyBudgetMs,
        dependencies.nowFn(),
        "before_apply",
        deadline.getRemainingInvocationTimeMs,
      );
      return await replayCommitUnknown(
        () => dependencies.applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn(
          input.userId,
          input.workspaceId,
          normalizedInput,
          writer,
          deadline.operationDeadlineAt,
        ),
        deadline.requestDeadlineAtMs,
        dependencies.nowFn,
        deadline.getRemainingInvocationTimeMs,
      );
    } catch (error) {
      let resolution: DirectWriterStatus;
      try {
        resolution = await resolveDirectWriterFailure(
          writer,
          lease.leaseExpiresAt,
          deadline,
          dependencies,
        );
      } catch (resolutionError) {
        if (resolutionError instanceof HttpError) {
          throw resolutionError;
        }
        throw new AggregateError(
          [error, resolutionError],
          "Media asset ingestion failed and exact attempt resolution also failed.",
        );
      }
      if (isReplayedApplyStatus(resolution)) {
        return dependencies.replayImageNormalizedMediaAssetForWorkspaceFn(
          input.userId,
          input.workspaceId,
          normalizedInput,
          resolution,
          deadline.requestDeadlineAtMs,
        );
      }
      if (resolution !== "unreferenced") {
        throwDirectAttemptStatus(
          resolution,
          lease.leaseExpiresAt,
          deadline,
          dependencies.nowFn(),
        );
      }
      if (error instanceof MediaBlobWriterOperationDeadlineExpiredError) {
        throw createDirectImageIngestionDeadlineError("storage_and_apply");
      }
      throw error;
    }
  } finally {
    deadline.dispose();
  }
}

export async function ingestImageMediaAsset(
  input: ImageMediaAssetIngestionInput,
): Promise<ImageMediaAssetIngestionResult> {
  const requestDeadline = createDirectImageIngestionRequestDeadline(
    createStandaloneDirectImageIngestionRequestTiming(Date.now()),
  );
  try {
    return await ingestImageMediaAssetWithRequestDeadline(input, requestDeadline);
  } finally {
    requestDeadline.dispose();
  }
}

export async function ingestImageMediaAssetWithRequestDeadline(
  input: ImageMediaAssetIngestionInput,
  requestDeadline: DirectImageIngestionRequestDeadline,
): Promise<ImageMediaAssetIngestionResult> {
  return ingestImageMediaAssetWithDependencies(input, requestDeadline, {
    createAttemptTokenFn: randomUUID,
    createAbortHandleFn: createDirectImageIngestionAbortHandle,
    nowFn: Date.now,
    normalizeImageBytesForCardFn: normalizeImageBytesForCardUntilDeadline,
    waitForWriterLeaseExpiryFn: waitForWriterLeaseExpiry,
    beginDirectMediaBlobWriterAttemptWithOwnerFn: beginDirectMediaBlobWriterAttemptWithOwner,
    resolveDirectMediaBlobWriterAttemptAfterAccessRevocationFn:
      resolveDirectMediaBlobWriterAttemptAfterAccessRevocation,
    resolveDirectMediaBlobWriterAttemptFailureWithOwnerFn:
      resolveDirectMediaBlobWriterAttemptFailureWithOwner,
    loadReusableImageMediaBlobForWorkspaceFn: loadReusableImageMediaBlobForWorkspace,
    replayImageNormalizedMediaAssetForWorkspaceFn: replayImageNormalizedMediaAssetForWorkspace,
    storeMediaAssetBlobBytesIfAbsentFn: storeMediaAssetBlobBytesIfAbsent,
    applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn:
      applyImageNormalizedMediaAssetWithDirectWriterForWorkspace,
  });
}
