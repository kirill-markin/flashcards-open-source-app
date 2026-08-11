import { createHash } from "node:crypto";
import {
  DatabaseDeadlineExceededError,
  type DatabaseExecutor,
} from "../../database";
import { unsafeTransactionWithDeadline } from "../../database/unsafe";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import { MediaBlobLifecycleConflictError } from "../../mediaAssets/blobLifecycle";
import {
  assertMediaBlobMatchesMetadata,
  findMediaBlobRowBySha256InExecutor,
  mapMediaBlobRow,
} from "../../mediaAssets/persistence";
import { storeCatalogImageBlobBytesIfAbsent } from "../../mediaAssets/storage/direct";
import { buildMediaBlobStorageKey } from "../../mediaAssets/storageKeys";
import {
  imageJpegCardMediaBlobNormalizationVersion,
  imageJpegCatalogCoverMediaBlobNormalizationVersion,
  mediaBlobNormalizationVersions,
  type MediaBlob,
  type MediaBlobNormalizationVersion,
  type MediaBlobRow,
} from "../../mediaAssets/types";
import {
  normalizeImageBytesForCardUntilDeadline,
  normalizeImageBytesForCatalogCoverUntilDeadline,
  type NormalizedImageBytes,
} from "../../mediaAssets/ingestion/imageNormalization";
import type { BackendObservationScope } from "../../observability/sentry/events";
import { HttpError } from "../../shared/errors";
import { maximumPublicCatalogMediaDownloadBytes } from "../publicMediaDelivery";
import type { CatalogPackageMediaAsset } from "../types";
import {
  createOrReplayCatalogPackageDraftCardImageInExecutor,
  replaceCatalogPackageDraftCoverInExecutor,
  type CatalogPackageMediaMutationResult,
} from "./draftMedia";

const catalogImageBlobAdmissionCleanupDelayMs = 3_600_000;
const maximumCatalogImageBlobIngestionRequestLifetimeMs = 60_000;

type CatalogImageBlobIngestionInput = Readonly<{
  imageBytes: Buffer;
  deadlineAtMs: number;
  signal: AbortSignal;
  observationScope: BackendObservationScope;
}>;

export type CatalogPackageCardImageIngestionInput =
  CatalogImageBlobIngestionInput & Readonly<{
    packageId: string;
    packageMediaKey: string;
  }>;

export type CatalogPackageCoverImageIngestionInput =
  CatalogImageBlobIngestionInput & Readonly<{
    packageId: string;
  }>;

export type CatalogPackageImageIngestionResult = Readonly<{
  mediaAsset: CatalogPackageMediaAsset;
  applied: boolean;
  mimeType: string;
  sizeBytes: number;
}>;

type CatalogImageBlobMetadata = Readonly<{
  sha256: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  normalizationVersion: MediaBlobNormalizationVersion;
}>;

type CatalogImageBlobAdmissionRow = Readonly<{
  normalization_version: string;
}>;

type CatalogImageBlobDeadline = Readonly<{
  signal: AbortSignal;
  dispose: () => void;
}>;

type CatalogImageBlobIngestionDependencies = Readonly<{
  admitCatalogImageBlobWriteFn: typeof admitCatalogImageBlobWrite;
  registerCatalogImageBlobFn: typeof registerCatalogImageBlob;
  storeCatalogImageBlobBytesIfAbsentFn:
    typeof storeCatalogImageBlobBytesIfAbsent;
  nowFn: () => number;
}>;

function hasSqlState(error: unknown, sqlState: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === sqlState;
}

function requireNormalizationVersion(value: string): MediaBlobNormalizationVersion {
  const normalizationVersion = mediaBlobNormalizationVersions.find(
    (candidate) => candidate === value,
  );
  if (normalizationVersion !== undefined) {
    return normalizationVersion;
  }
  throw new TypeError(
    "PostgreSQL returned an unsupported catalog image normalization version.",
  );
}

function createCatalogImageBlobDeadlineError(): HttpError {
  return new HttpError(
    503,
    "Catalog image ingestion cannot safely finish within its bounded request deadline.",
    "CATALOG_IMAGE_INGESTION_DEADLINE_INVALID",
    { retryAfterSeconds: 1 },
  );
}

function assertCatalogImageBlobDeadline(
  deadlineAtMs: number,
  nowMs: number,
): void {
  const remainingMs = deadlineAtMs - nowMs;
  if (
    !Number.isSafeInteger(deadlineAtMs)
    || !Number.isFinite(nowMs)
    || remainingMs < 1_000
    || remainingMs > maximumCatalogImageBlobIngestionRequestLifetimeMs
  ) {
    throw createCatalogImageBlobDeadlineError();
  }
}

function assertCatalogImageBlobRequestActive(
  deadlineAtMs: number,
  signal: AbortSignal,
  nowMs: number,
): void {
  signal.throwIfAborted();
  assertCatalogImageBlobDeadline(deadlineAtMs, nowMs);
}

function createCatalogImageBlobDeadline(
  input: CatalogImageBlobIngestionInput,
): CatalogImageBlobDeadline {
  const nowMs = Date.now();
  assertCatalogImageBlobDeadline(input.deadlineAtMs, nowMs);
  input.signal.throwIfAborted();
  const controller = new AbortController();
  const deadlineError = createCatalogImageBlobDeadlineError();
  const timer = setTimeout(
    () => controller.abort(deadlineError),
    input.deadlineAtMs - nowMs,
  );
  timer.unref();
  return Object.freeze({
    signal: AbortSignal.any([input.signal, controller.signal]),
    dispose: () => clearTimeout(timer),
  });
}

function rethrowCatalogImageBlobRequestError(
  error: unknown,
  signal: AbortSignal,
): never {
  if (signal.aborted) {
    signal.throwIfAborted();
  }
  if (
    error instanceof DatabaseDeadlineExceededError
    || (
      error instanceof HttpError
      && error.code === "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED"
    )
  ) {
    throw createCatalogImageBlobDeadlineError();
  }
  throw error;
}

async function withCatalogImageBlobDeadline<Result>(
  input: CatalogImageBlobIngestionInput,
  operation: (deadlineInput: CatalogImageBlobIngestionInput) => Promise<Result>,
): Promise<Result> {
  const deadline = createCatalogImageBlobDeadline(input);
  const deadlineInput = { ...input, signal: deadline.signal };
  try {
    const result = await operation(deadlineInput);
    assertCatalogImageBlobRequestActive(
      input.deadlineAtMs,
      deadline.signal,
      Date.now(),
    );
    return result;
  } catch (error) {
    rethrowCatalogImageBlobRequestError(error, deadline.signal);
  } finally {
    deadline.dispose();
  }
}

function assertCatalogImageBlobWithinPublicLimit(
  normalizedImage: NormalizedImageBytes,
): void {
  if (normalizedImage.sizeBytes <= maximumPublicCatalogMediaDownloadBytes) {
    return;
  }
  throw new HttpError(
    413,
    [
      "Normalized catalog image exceeds the public catalog media limit.",
      `normalizedSizeBytes=${normalizedImage.sizeBytes}`,
      `maximumSizeBytes=${maximumPublicCatalogMediaDownloadBytes}`,
    ].join(" "),
    "CATALOG_IMAGE_NORMALIZED_TOO_LARGE",
  );
}

function toCatalogImageBlobMetadata(
  normalizedImage: NormalizedImageBytes,
  normalizationVersion: MediaBlobNormalizationVersion,
): CatalogImageBlobMetadata {
  const sha256 = createHash("sha256")
    .update(normalizedImage.bytes)
    .digest("hex");
  return {
    sha256,
    storageKey: buildMediaBlobStorageKey(sha256),
    mimeType: normalizedImage.mimeType,
    sizeBytes: normalizedImage.sizeBytes,
    normalizationVersion,
  };
}

async function replayCommitUnknown<Result>(
  operation: () => Promise<Result>,
  deadlineAtMs: number,
  signal: AbortSignal,
  nowFn: () => number,
): Promise<Result> {
  for (;;) {
    assertCatalogImageBlobRequestActive(deadlineAtMs, signal, nowFn());
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DatabaseCommitOutcomeUnknownError)) {
        throw error;
      }
      assertCatalogImageBlobRequestActive(deadlineAtMs, signal, nowFn());
    }
  }
}

function rethrowCatalogImageBlobAdmissionError(error: unknown): never {
  if (hasSqlState(error, "23514")) {
    throw new MediaBlobLifecycleConflictError();
  }
  throw error;
}

async function admitCatalogImageBlobWrite(
  input: CatalogImageBlobMetadata,
  deadlineAtMs: number,
): Promise<MediaBlobNormalizationVersion> {
  try {
    return await unsafeTransactionWithDeadline(deadlineAtMs, async (executor) => {
      const result = await executor.query<CatalogImageBlobAdmissionRow>(
        "SELECT * FROM content.admit_catalog_image_blob_write($1, $2, $3, $4, $5, $6)",
        [
          input.sha256,
          input.storageKey,
          input.mimeType,
          input.sizeBytes,
          input.normalizationVersion,
          catalogImageBlobAdmissionCleanupDelayMs,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new TypeError(
          "PostgreSQL did not return a valid catalog image blob admission.",
        );
      }
      return requireNormalizationVersion(row.normalization_version);
    });
  } catch (error) {
    rethrowCatalogImageBlobAdmissionError(error);
  }
}

async function registerCatalogImageBlobInExecutor(
  executor: DatabaseExecutor,
  input: CatalogImageBlobMetadata,
): Promise<MediaBlob> {
  const insertResult = await executor.query<MediaBlobRow>(
    [
      "INSERT INTO content.media_blobs",
      "(media_blob_id, sha256, mime_type, size_bytes, storage_key, normalization_version)",
      "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)",
      "ON CONFLICT (sha256) DO NOTHING",
      "RETURNING media_blob_id, mime_type, size_bytes, sha256, storage_key, normalization_version, created_at, updated_at",
    ].join(" "),
    [
      input.sha256,
      input.mimeType,
      input.sizeBytes,
      input.storageKey,
      input.normalizationVersion,
    ],
  );
  const row = insertResult.rows[0]
    ?? await findMediaBlobRowBySha256InExecutor(executor, input.sha256);
  if (row === null || row === undefined) {
    throw new Error(
      `Catalog media blob insert conflicted but no row was found. sha256=${input.sha256}`,
    );
  }
  assertMediaBlobMatchesMetadata(row, input);
  return mapMediaBlobRow(row);
}

async function registerCatalogImageBlob(
  input: CatalogImageBlobMetadata,
  deadlineAtMs: number,
): Promise<MediaBlob> {
  try {
    return await unsafeTransactionWithDeadline(
      deadlineAtMs,
      (executor) => registerCatalogImageBlobInExecutor(executor, input),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (hasSqlState(error, "23514")) {
      throw new MediaBlobLifecycleConflictError();
    }
    throw error;
  }
}

async function storeNormalizedCatalogImageBlob(
  input: CatalogImageBlobIngestionInput,
  normalizedImage: NormalizedImageBytes,
  normalizationVersion: MediaBlobNormalizationVersion,
  dependencies: CatalogImageBlobIngestionDependencies,
): Promise<MediaBlob> {
  assertCatalogImageBlobRequestActive(
    input.deadlineAtMs,
    input.signal,
    dependencies.nowFn(),
  );
  assertCatalogImageBlobWithinPublicLimit(normalizedImage);
  const metadata = toCatalogImageBlobMetadata(
    normalizedImage,
    normalizationVersion,
  );
  const admittedNormalizationVersion = await replayCommitUnknown(
    () => dependencies.admitCatalogImageBlobWriteFn(
      metadata,
      input.deadlineAtMs,
    ),
    input.deadlineAtMs,
    input.signal,
    dependencies.nowFn,
  );
  assertCatalogImageBlobRequestActive(
    input.deadlineAtMs,
    input.signal,
    dependencies.nowFn(),
  );
  await dependencies.storeCatalogImageBlobBytesIfAbsentFn({
    signal: input.signal,
    storageKey: metadata.storageKey,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    sha256: metadata.sha256,
    bytes: normalizedImage.bytes,
    observationScope: input.observationScope,
  });
  assertCatalogImageBlobRequestActive(
    input.deadlineAtMs,
    input.signal,
    dependencies.nowFn(),
  );
  return replayCommitUnknown(
    () => dependencies.registerCatalogImageBlobFn(
      { ...metadata, normalizationVersion: admittedNormalizationVersion },
      input.deadlineAtMs,
    ),
    input.deadlineAtMs,
    input.signal,
    dependencies.nowFn,
  );
}

const productionCatalogImageBlobIngestionDependencies: CatalogImageBlobIngestionDependencies = {
  admitCatalogImageBlobWriteFn: admitCatalogImageBlobWrite,
  registerCatalogImageBlobFn: registerCatalogImageBlob,
  storeCatalogImageBlobBytesIfAbsentFn: storeCatalogImageBlobBytesIfAbsent,
  nowFn: Date.now,
};

async function ingestCatalogCardImageBlobWithDeadline(
  input: CatalogImageBlobIngestionInput,
): Promise<MediaBlob> {
  const normalizedImage = await normalizeImageBytesForCardUntilDeadline(
    input.imageBytes,
    input.deadlineAtMs,
    input.signal,
  );
  return storeNormalizedCatalogImageBlob(
    input,
    normalizedImage,
    imageJpegCardMediaBlobNormalizationVersion,
    productionCatalogImageBlobIngestionDependencies,
  );
}

async function ingestCatalogCoverImageBlobWithDeadline(
  input: CatalogImageBlobIngestionInput,
): Promise<MediaBlob> {
  const normalizedImage = await normalizeImageBytesForCatalogCoverUntilDeadline(
    input.imageBytes,
    input.deadlineAtMs,
    input.signal,
  );
  return storeNormalizedCatalogImageBlob(
    input,
    normalizedImage,
    imageJpegCatalogCoverMediaBlobNormalizationVersion,
    productionCatalogImageBlobIngestionDependencies,
  );
}

async function mutateCatalogPackageImageWithReplay(
  operation: (executor: DatabaseExecutor) => Promise<CatalogPackageMediaMutationResult>,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<CatalogPackageMediaMutationResult> {
  return replayCommitUnknown(
    () => unsafeTransactionWithDeadline(deadlineAtMs, operation),
    deadlineAtMs,
    signal,
    Date.now,
  );
}

function toCatalogPackageImageIngestionResult(
  mediaBlob: MediaBlob,
  mutation: CatalogPackageMediaMutationResult,
): CatalogPackageImageIngestionResult {
  return {
    mediaAsset: mutation.mediaAsset,
    applied: mutation.applied,
    mimeType: mediaBlob.mimeType,
    sizeBytes: mediaBlob.sizeBytes,
  };
}

export async function ingestCatalogCardImageBlob(
  input: CatalogImageBlobIngestionInput,
): Promise<MediaBlob> {
  return withCatalogImageBlobDeadline(
    input,
    ingestCatalogCardImageBlobWithDeadline,
  );
}

export async function ingestCatalogCoverImageBlob(
  input: CatalogImageBlobIngestionInput,
): Promise<MediaBlob> {
  return withCatalogImageBlobDeadline(
    input,
    ingestCatalogCoverImageBlobWithDeadline,
  );
}

export async function ingestCatalogPackageCardImage(
  input: CatalogPackageCardImageIngestionInput,
): Promise<CatalogPackageImageIngestionResult> {
  return withCatalogImageBlobDeadline(input, async (deadlineInput) => {
    const mediaBlob = await ingestCatalogCardImageBlobWithDeadline(deadlineInput);
    const mutation = await mutateCatalogPackageImageWithReplay(
      (executor) => createOrReplayCatalogPackageDraftCardImageInExecutor(
        executor,
        input.packageId,
        input.packageMediaKey,
        mediaBlob.mediaBlobId,
      ),
      deadlineInput.deadlineAtMs,
      deadlineInput.signal,
    );
    return toCatalogPackageImageIngestionResult(mediaBlob, mutation);
  });
}

export async function replaceCatalogPackageCoverImage(
  input: CatalogPackageCoverImageIngestionInput,
): Promise<CatalogPackageImageIngestionResult> {
  return withCatalogImageBlobDeadline(input, async (deadlineInput) => {
    const mediaBlob = await ingestCatalogCoverImageBlobWithDeadline(deadlineInput);
    const mutation = await mutateCatalogPackageImageWithReplay(
      (executor) => replaceCatalogPackageDraftCoverInExecutor(
        executor,
        input.packageId,
        mediaBlob.mediaBlobId,
      ),
      deadlineInput.deadlineAtMs,
      deadlineInput.signal,
    );
    return toCatalogPackageImageIngestionResult(mediaBlob, mutation);
  });
}
