import {
  ApiContractError,
  ApiError,
  abortMediaAssetUploadSession,
  completeMediaAssetUploadSession,
  createMediaAssetUploadPartUrls,
  createMediaAssetUploadSession,
  isAuthRedirectError,
} from "../../api";
import { putMediaAsset } from "../../localDb/mediaAssets";
import {
  claimNextDueMediaTransferByKind,
  loadMediaBlobCacheRecord,
  markClaimedMediaTransferFailed,
  markClaimedMediaTransferSucceeded,
  recoverStaleInProgressMediaTransfersByKind,
  renewInProgressMediaTransferClaim,
  type MediaBlobCacheRecord,
  type MediaTransferQueueRecord,
} from "../../localDb/mediaTransfers";
import { loadCloudSettings } from "../../localDb/sync/cloudSettings";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAsset,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadPartUrl,
  MediaAssetUploadSession,
} from "../../types";
import { requireCloudInstallationId } from "./local/syncCloudSettings";

type VerifiedUploadBytes = Readonly<{
  bytes: Uint8Array;
  blob: Blob;
}>;

type PlannedUploadPart = Readonly<{
  partNumber: number;
  sha256: string;
  startByte: number;
  endByte: number;
}>;

type UploadedMediaPart = Readonly<{
  partNumber: number;
  eTag: string;
  sha256: string;
}>;

type MediaUploadFailureKind = "retryable" | "permanent";

type MediaUploadFailure = Readonly<{
  kind: MediaUploadFailureKind;
  message: string;
}>;

type MediaUploadClaimHeartbeat = Readonly<{
  getClaimedAt: () => string;
  throwIfFailed: () => Promise<void>;
  stop: () => Promise<unknown | null>;
}>;

class RetryableMediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableMediaUploadError";
  }
}

class PermanentMediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMediaUploadError";
  }
}

const browserMediaUploadPartSizeBytes = 8 * 1024 * 1024;
const retryBaseDelayMs = 30_000;
const retryMaximumDelayMs = 30 * 60_000;
const signedPartUploadMaximumAttemptCount = 2;
const signedPartUploadRetryDelayMs = 250;
const signedPartUrlExpirySafetyMarginMs = 60_000;
const signedPartUploadErrorBodyMaximumBytes = 4096;
const signedPartUploadErrorFieldMaximumLength = 128;
const staleMediaUploadClaimLeaseMs = 30 * 60_000;
const mediaUploadClaimHeartbeatMs = 5 * 60_000;
const permanentlyFailedNextAttemptAt = "9999-12-31T23:59:59.999Z";
const retryableUploadSessionErrorCodes: ReadonlySet<string> = new Set([
  "MEDIA_ASSET_STORAGE_UNAVAILABLE",
  "MEDIA_ASSET_UPLOAD_NOT_FOUND",
  "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED",
  "MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND",
  "MEDIA_ASSET_UPLOAD_SESSION_RECOVERY_FAILED",
]);

function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function readErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return error.name;
  }

  return typeof error;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return String(error);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toUuidFromHexDigest(hexDigest: string): string {
  const baseHex = hexDigest.slice(0, 32).split("");
  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const exactBytes: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  return exactBytes.buffer;
}

function requireSha256Digest(): SubtleCrypto {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle === undefined) {
    throw new PermanentMediaUploadError("Media upload verification failed: Web Crypto SHA-256 digest is unavailable");
  }

  return cryptoApi.subtle;
}

async function calculateSha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await requireSha256Digest().digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function buildClientWorkspaceReplicaId(workspaceId: string, installationId: string): Promise<string> {
  const seedBytes = new TextEncoder().encode(`${workspaceId}:${installationId}`);
  return toUuidFromHexDigest(await calculateSha256Hex(toExactArrayBuffer(seedBytes)));
}

function assertUploadCacheRecordMatchesTransfer(
  transfer: MediaTransferQueueRecord,
  cacheRecord: MediaBlobCacheRecord,
): void {
  if (cacheRecord.sha256 !== transfer.sha256) {
    throw new PermanentMediaUploadError(`Media upload cache sha256 mismatch: transferId=${transfer.transferId}, expectedSha256=${transfer.sha256}, actualSha256=${cacheRecord.sha256}`);
  }

  if (cacheRecord.sizeBytes !== transfer.sizeBytes) {
    throw new PermanentMediaUploadError(`Media upload cache size metadata mismatch: transferId=${transfer.transferId}, expectedSizeBytes=${transfer.sizeBytes}, actualSizeBytes=${cacheRecord.sizeBytes}`);
  }

  if (cacheRecord.blob.size !== transfer.sizeBytes) {
    throw new PermanentMediaUploadError(`Media upload cache blob size mismatch: transferId=${transfer.transferId}, expectedSizeBytes=${transfer.sizeBytes}, actualSizeBytes=${cacheRecord.blob.size}`);
  }
}

function assertUploadedMediaAssetMatchesTransfer(
  transfer: MediaTransferQueueRecord,
  mediaAsset: MediaAsset,
): void {
  if (mediaAsset.workspaceId !== transfer.workspaceId) {
    throw new PermanentMediaUploadError(`Media upload asset workspace mismatch: transferId=${transfer.transferId}, expectedWorkspaceId=${transfer.workspaceId}, actualWorkspaceId=${mediaAsset.workspaceId}`);
  }

  if (mediaAsset.mediaAssetId !== transfer.mediaAssetId) {
    throw new PermanentMediaUploadError(`Media upload asset id mismatch: transferId=${transfer.transferId}, expectedMediaAssetId=${transfer.mediaAssetId}, actualMediaAssetId=${mediaAsset.mediaAssetId}`);
  }

  if (mediaAsset.sha256 !== transfer.sha256) {
    throw new PermanentMediaUploadError(`Media upload asset sha256 mismatch: transferId=${transfer.transferId}, expectedSha256=${transfer.sha256}, actualSha256=${mediaAsset.sha256}`);
  }

  if (mediaAsset.sizeBytes !== transfer.sizeBytes) {
    throw new PermanentMediaUploadError(`Media upload asset size mismatch: transferId=${transfer.transferId}, expectedSizeBytes=${transfer.sizeBytes}, actualSizeBytes=${mediaAsset.sizeBytes}`);
  }

  if (mediaAsset.mimeType !== transfer.mimeType) {
    throw new PermanentMediaUploadError(`Media upload asset MIME type mismatch: transferId=${transfer.transferId}, expectedMimeType=${transfer.mimeType}, actualMimeType=${mediaAsset.mimeType}`);
  }

  if (mediaAsset.deletedAt !== null) {
    throw new PermanentMediaUploadError(`Media upload asset is deleted: transferId=${transfer.transferId}, mediaAssetId=${mediaAsset.mediaAssetId}, deletedAt=${mediaAsset.deletedAt}`);
  }
}

function assertUploadSessionCreateResultMatchesTransfer(
  transfer: MediaTransferQueueRecord,
  result: MediaAssetUploadSessionCreateResult,
): void {
  if (result.workspaceId !== transfer.workspaceId) {
    throw new PermanentMediaUploadError(`Media upload session workspace mismatch: transferId=${transfer.transferId}, expectedWorkspaceId=${transfer.workspaceId}, actualWorkspaceId=${result.workspaceId}`);
  }

  if (result.mediaAssetId !== transfer.mediaAssetId) {
    throw new PermanentMediaUploadError(`Media upload session media asset id mismatch: transferId=${transfer.transferId}, expectedMediaAssetId=${transfer.mediaAssetId}, actualMediaAssetId=${result.mediaAssetId}`);
  }
}

async function loadVerifiedUploadBytes(transfer: MediaTransferQueueRecord): Promise<VerifiedUploadBytes> {
  if (transfer.sourceBlobCacheKey === null) {
    throw new PermanentMediaUploadError(`Media upload source blob is missing: transferId=${transfer.transferId}`);
  }

  if (transfer.sizeBytes < 1) {
    throw new PermanentMediaUploadError(`Media upload size must be positive: transferId=${transfer.transferId}, sizeBytes=${transfer.sizeBytes}`);
  }

  const cacheRecord = await loadMediaBlobCacheRecord(transfer.sourceBlobCacheKey);
  if (cacheRecord === null) {
    throw new PermanentMediaUploadError(`Media upload source blob cache record was not found: transferId=${transfer.transferId}, sourceBlobCacheKey=${transfer.sourceBlobCacheKey}`);
  }

  assertUploadCacheRecordMatchesTransfer(transfer, cacheRecord);
  const bytes = new Uint8Array(await cacheRecord.blob.arrayBuffer());
  if (bytes.byteLength !== transfer.sizeBytes) {
    throw new PermanentMediaUploadError(`Media upload source byte length mismatch: transferId=${transfer.transferId}, expectedSizeBytes=${transfer.sizeBytes}, actualSizeBytes=${bytes.byteLength}`);
  }

  const actualSha256 = await calculateSha256Hex(toExactArrayBuffer(bytes));
  if (actualSha256 !== transfer.sha256) {
    throw new PermanentMediaUploadError(`Media upload source sha256 mismatch: transferId=${transfer.transferId}, expectedSha256=${transfer.sha256}, actualSha256=${actualSha256}`);
  }

  return {
    bytes,
    blob: cacheRecord.blob,
  };
}

function calculatePartCount(sizeBytes: number, partSizeBytes: number): number {
  return Math.ceil(sizeBytes / partSizeBytes);
}

function buildUploadSessionCreateInput(
  transfer: MediaTransferQueueRecord,
  lastModifiedByReplicaId: string,
): Parameters<typeof createMediaAssetUploadSession>[1] {
  return {
    mediaAssetId: transfer.mediaAssetId,
    mimeType: transfer.mimeType,
    sizeBytes: transfer.sizeBytes,
    sha256: transfer.sha256,
    partSizeBytes: browserMediaUploadPartSizeBytes,
    partCount: calculatePartCount(transfer.sizeBytes, browserMediaUploadPartSizeBytes),
    sourceUrl: null,
    createdAt: transfer.createdAt,
    clientUpdatedAt: transfer.createdAt,
    lastModifiedByReplicaId,
    lastOperationId: transfer.transferId,
  };
}

function assertUploadSessionMatchesBytes(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
): void {
  const expectedPartCount = calculatePartCount(transfer.sizeBytes, uploadSession.partSizeBytes);
  if (uploadSession.partCount !== expectedPartCount) {
    throw new PermanentMediaUploadError(`Media upload session part count mismatch: transferId=${transfer.transferId}, sessionId=${uploadSession.sessionId}, expectedPartCount=${expectedPartCount}, actualPartCount=${uploadSession.partCount}`);
  }
}

async function buildPlannedUploadParts(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
  bytes: Uint8Array,
): Promise<ReadonlyArray<PlannedUploadPart>> {
  assertUploadSessionMatchesBytes(transfer, uploadSession);
  const uploadParts: Array<PlannedUploadPart> = [];
  for (let partIndex = 0; partIndex < uploadSession.partCount; partIndex += 1) {
    const startByte = partIndex * uploadSession.partSizeBytes;
    const endByte = Math.min(startByte + uploadSession.partSizeBytes, transfer.sizeBytes);
    const partBytes = bytes.subarray(startByte, endByte);
    uploadParts.push({
      partNumber: partIndex + 1,
      sha256: await calculateSha256Hex(toExactArrayBuffer(partBytes)),
      startByte,
      endByte,
    });
  }

  return uploadParts;
}

function isTransientStatusCode(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isRetryableApiError(error: ApiError): boolean {
  if (error.statusCode === 0 || isTransientStatusCode(error.statusCode)) {
    return true;
  }

  return error.code !== null && retryableUploadSessionErrorCodes.has(error.code);
}

function describeApiError(error: ApiError): string {
  return [
    error.message,
    `endpoint=${error.endpoint}`,
    `status=${error.statusCode}`,
    `code=${error.code ?? "none"}`,
    `requestId=${error.requestId ?? "none"}`,
    `responseBodyKind=${error.responseBodyKind}`,
  ].join(" ");
}

function describeUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiError(error);
  }

  return readErrorMessage(error);
}

function classifyMediaUploadError(error: unknown): MediaUploadFailure {
  if (error instanceof RetryableMediaUploadError) {
    return {
      kind: "retryable",
      message: error.message,
    };
  }

  if (error instanceof PermanentMediaUploadError || error instanceof ApiContractError) {
    return {
      kind: "permanent",
      message: describeUploadError(error),
    };
  }

  if (error instanceof ApiError) {
    return {
      kind: isRetryableApiError(error) ? "retryable" : "permanent",
      message: describeApiError(error),
    };
  }

  return {
    kind: "retryable",
    message: readErrorMessage(error),
  };
}

function describeUploadSessionCleanupFailure(primaryFailure: MediaUploadFailure, abortFailure: MediaUploadFailure): string {
  return `Media upload session cleanup failed after upload error: primaryError=${primaryFailure.message}, abortError=${abortFailure.message}`;
}

function combineUploadFailureWithAbortFailure(primaryError: unknown, abortError: unknown | null): unknown {
  if (abortError === null || isAuthRedirectError(primaryError)) {
    return primaryError;
  }

  if (isAuthRedirectError(abortError)) {
    return abortError;
  }

  const primaryFailure = classifyMediaUploadError(primaryError);
  const abortFailure = classifyMediaUploadError(abortError);
  if (primaryFailure.kind === "retryable" || abortFailure.kind === "retryable") {
    return new RetryableMediaUploadError(describeUploadSessionCleanupFailure(primaryFailure, abortFailure));
  }

  return new PermanentMediaUploadError(describeUploadSessionCleanupFailure(primaryFailure, abortFailure));
}

function createRetryNextAttemptAt(transfer: MediaTransferQueueRecord, failedAt: string): string {
  const nextAttemptCount = transfer.attemptCount + 1;
  const uncappedDelayMs = retryBaseDelayMs * (2 ** Math.max(0, nextAttemptCount - 1));
  const delayMs = Math.min(uncappedDelayMs, retryMaximumDelayMs);
  return new Date(new Date(failedAt).getTime() + delayMs).toISOString();
}

function createStaleUploadClaimCutoff(recoveredAt: string): string {
  return new Date(new Date(recoveredAt).getTime() - staleMediaUploadClaimLeaseMs).toISOString();
}

function requireInProgressUploadClaimedAt(transfer: MediaTransferQueueRecord): string {
  if (transfer.claimedAt === null) {
    throw new PermanentMediaUploadError(`Media upload transfer claim is missing: transferId=${transfer.transferId}`);
  }

  return transfer.claimedAt;
}

async function renewUploadTransferClaim(
  transfer: MediaTransferQueueRecord,
  expectedClaimedAt: string,
): Promise<string> {
  const renewedAt = new Date().toISOString();
  const renewedTransfer = await renewInProgressMediaTransferClaim({
    transferId: transfer.transferId,
    kind: "upload",
    expectedClaimedAt,
    renewedAt,
  });
  return requireInProgressUploadClaimedAt(renewedTransfer);
}

function startUploadClaimHeartbeat(transfer: MediaTransferQueueRecord): MediaUploadClaimHeartbeat {
  let claimedAt = requireInProgressUploadClaimedAt(transfer);
  let heartbeatError: unknown = null;
  let renewalTask: Promise<void> = Promise.resolve();
  let didStop = false;

  const queueRenewal = (): void => {
    if (heartbeatError !== null || didStop) {
      return;
    }

    renewalTask = renewalTask
      .then(async (): Promise<void> => {
        claimedAt = await renewUploadTransferClaim(transfer, claimedAt);
      })
      .catch((error: unknown): void => {
        heartbeatError = error;
      });
  };

  const timerId = window.setInterval(queueRenewal, mediaUploadClaimHeartbeatMs);
  queueRenewal();

  return {
    getClaimedAt: () => claimedAt,
    throwIfFailed: async (): Promise<void> => {
      await renewalTask;
      if (heartbeatError !== null) {
        throw heartbeatError;
      }
    },
    stop: async (): Promise<unknown | null> => {
      if (didStop === false) {
        didStop = true;
        window.clearInterval(timerId);
      }

      await renewalTask;
      return heartbeatError;
    },
  };
}

async function recoverStaleUploadTransferClaims(workspaceId: string, recoveredAt: string): Promise<void> {
  const staleClaimedBefore = createStaleUploadClaimCutoff(recoveredAt);
  await recoverStaleInProgressMediaTransfersByKind({
    workspaceId,
    kind: "upload",
    staleClaimedBefore,
    recoveredAt,
    nextAttemptAt: recoveredAt,
    lastError: `Media upload transfer reclaimed after stale in-progress claim: staleClaimedBefore=${staleClaimedBefore}, recoveredAt=${recoveredAt}`,
  });
}

async function markUploadTransferFailed(
  transfer: MediaTransferQueueRecord,
  claimedAt: string,
  error: unknown,
): Promise<void> {
  const failedAt = new Date().toISOString();
  const failure = classifyMediaUploadError(error);
  const nextAttemptAt = failure.kind === "retryable"
    ? createRetryNextAttemptAt(transfer, failedAt)
    : permanentlyFailedNextAttemptAt;
  await markClaimedMediaTransferFailed({
    transferId: transfer.transferId,
    kind: "upload",
    expectedClaimedAt: claimedAt,
    failedAt,
    lastError: `Media upload transfer failed (${failure.kind}): transferId=${transfer.transferId}, workspaceId=${transfer.workspaceId}, mediaAssetId=${transfer.mediaAssetId}, error=${failure.message}`,
    nextAttemptAt,
  });
}

async function markAuthRedirectUploadTransferRetryable(
  transfer: MediaTransferQueueRecord,
  claimedAt: string,
): Promise<void> {
  const failedAt = new Date().toISOString();
  await markClaimedMediaTransferFailed({
    transferId: transfer.transferId,
    kind: "upload",
    expectedClaimedAt: claimedAt,
    failedAt,
    lastError: `Media upload transfer paused for browser authentication: transferId=${transfer.transferId}, workspaceId=${transfer.workspaceId}, mediaAssetId=${transfer.mediaAssetId}`,
    nextAttemptAt: failedAt,
  });
}

async function waitForSignedPartUploadRetry(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, signedPartUploadRetryDelayMs);
  });
}

function warnSignedPartUploadRetry(
  transfer: MediaTransferQueueRecord,
  partNumber: number,
  attemptNumber: number,
  error: unknown,
): void {
  console.warn("Media upload part retry", {
    transferId: transfer.transferId,
    workspaceId: transfer.workspaceId,
    mediaAssetId: transfer.mediaAssetId,
    partNumber,
    attemptNumber,
    nextAttemptNumber: attemptNumber + 1,
    errorName: readErrorName(error),
    errorMessage: readErrorMessage(error),
  });
}

async function readSignedPartUploadFailureBodyText(response: Response): Promise<string | null> {
  const responseBody = response.body;
  if (responseBody === null) {
    return null;
  }

  const reader = responseBody.getReader();
  const chunks: Array<Uint8Array> = [];
  let totalByteLength = 0;
  try {
    while (totalByteLength < signedPartUploadErrorBodyMaximumBytes) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      const remainingByteLength = signedPartUploadErrorBodyMaximumBytes - totalByteLength;
      const chunk = result.value.byteLength > remainingByteLength
        ? result.value.slice(0, remainingByteLength)
        : result.value;
      chunks.push(chunk);
      totalByteLength += chunk.byteLength;
      if (result.value.byteLength >= remainingByteLength) {
        await reader.cancel();
        break;
      }
    }
  } catch (error) {
    console.warn("Media upload part failure body read failed", {
      errorName: readErrorName(error),
      errorMessage: toBoundedSignedPartErrorField(readErrorMessage(error)) ?? "none",
    });
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be released after cancellation.
    }
  }

  const bodyBytes = new Uint8Array(totalByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bodyBytes);
}

type SanitizedSignedPartUploadFailure = Readonly<{
  status: number;
  statusText: string;
  s3Code: string | null;
  requestId: string | null;
  extendedRequestId: string | null;
}>;

function readXmlElementText(documentValue: Document, tagName: string): string | null {
  const element = documentValue.getElementsByTagName(tagName)[0];
  if (element === undefined) {
    return null;
  }

  const text = element.textContent?.trim() ?? "";
  return text === "" ? null : text;
}

function toBoundedSignedPartErrorField(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return null;
  }

  if (trimmedValue.length <= signedPartUploadErrorFieldMaximumLength) {
    return trimmedValue;
  }

  return `${trimmedValue.slice(0, signedPartUploadErrorFieldMaximumLength)}...`;
}

function parseS3ErrorBody(responseBody: string | null): Pick<SanitizedSignedPartUploadFailure, "s3Code" | "requestId" | "extendedRequestId"> {
  if (responseBody === null || responseBody.trim() === "" || typeof DOMParser === "undefined") {
    return {
      s3Code: null,
      requestId: null,
      extendedRequestId: null,
    };
  }

  const documentValue = new DOMParser().parseFromString(responseBody, "application/xml");
  if (documentValue.getElementsByTagName("parsererror").length > 0) {
    return {
      s3Code: null,
      requestId: null,
      extendedRequestId: null,
    };
  }

  return {
    s3Code: readXmlElementText(documentValue, "Code"),
    requestId: readXmlElementText(documentValue, "RequestId"),
    extendedRequestId: readXmlElementText(documentValue, "HostId"),
  };
}

async function readSanitizedSignedPartUploadFailure(response: Response): Promise<SanitizedSignedPartUploadFailure> {
  const responseBody = await readSignedPartUploadFailureBodyText(response);
  const parsedBody = parseS3ErrorBody(responseBody);
  return {
    status: response.status,
    statusText: toBoundedSignedPartErrorField(response.statusText) ?? "",
    s3Code: toBoundedSignedPartErrorField(parsedBody.s3Code),
    requestId: toBoundedSignedPartErrorField(response.headers.get("x-amz-request-id") ?? parsedBody.requestId),
    extendedRequestId: toBoundedSignedPartErrorField(response.headers.get("x-amz-id-2") ?? parsedBody.extendedRequestId),
  };
}

function formatNullableSignedPartErrorField(value: string | null): string {
  return value ?? "none";
}

function describeSanitizedSignedPartUploadFailure(
  transfer: MediaTransferQueueRecord,
  part: PlannedUploadPart,
  failure: SanitizedSignedPartUploadFailure,
): string {
  return [
    "Media upload part failed:",
    `transferId=${transfer.transferId}`,
    `partNumber=${part.partNumber}`,
    `status=${failure.status}`,
    `statusText=${failure.statusText}`,
    `s3Code=${formatNullableSignedPartErrorField(failure.s3Code)}`,
    `requestId=${formatNullableSignedPartErrorField(failure.requestId)}`,
    `extendedRequestId=${formatNullableSignedPartErrorField(failure.extendedRequestId)}`,
  ].join(" ");
}

function assertSignedPartUrlUsable(
  transfer: MediaTransferQueueRecord,
  partUrl: MediaAssetUploadPartUrl,
  part: PlannedUploadPart,
): void {
  const expiresAtTime = Date.parse(partUrl.expiresAt);
  if (Number.isFinite(expiresAtTime) === false) {
    throw new PermanentMediaUploadError(`Media upload part URL expiration is invalid: transferId=${transfer.transferId}, partNumber=${part.partNumber}, expiresAt=${partUrl.expiresAt}`);
  }

  if (expiresAtTime - Date.now() <= signedPartUrlExpirySafetyMarginMs) {
    throw new RetryableMediaUploadError(`Media upload part URL expires too soon: transferId=${transfer.transferId}, partNumber=${part.partNumber}, expiresAt=${partUrl.expiresAt}, safetyMarginMs=${signedPartUrlExpirySafetyMarginMs}`);
  }
}

function warnUploadSessionAbortFailure(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  error: unknown,
): void {
  console.warn("Media upload session abort failed", {
    transferId: transfer.transferId,
    workspaceId: transfer.workspaceId,
    mediaAssetId: transfer.mediaAssetId,
    sessionId,
    errorName: readErrorName(error),
    errorMessage: describeUploadError(error),
  });
}

async function uploadSignedPartOnce(
  transfer: MediaTransferQueueRecord,
  partUrl: MediaAssetUploadPartUrl,
  part: PlannedUploadPart,
  blob: Blob,
): Promise<string> {
  assertSignedPartUrlUsable(transfer, partUrl, part);
  let response: Response;
  try {
    response = await fetch(partUrl.url, {
      method: partUrl.method,
      headers: partUrl.headers,
      body: blob.slice(part.startByte, part.endByte),
    });
  } catch (error) {
    throw new RetryableMediaUploadError(`Media upload part request failed: transferId=${transfer.transferId}, partNumber=${part.partNumber}, errorName=${readErrorName(error)}`);
  }

  if (response.ok === false) {
    const failure = await readSanitizedSignedPartUploadFailure(response);
    const message = describeSanitizedSignedPartUploadFailure(transfer, part, failure);
    if (isTransientStatusCode(response.status) || response.status === 403) {
      throw new RetryableMediaUploadError(message);
    }

    throw new PermanentMediaUploadError(message);
  }

  const eTag = response.headers.get("ETag");
  if (eTag === null || eTag.trim() === "") {
    throw new PermanentMediaUploadError(`Media upload part response missing ETag: transferId=${transfer.transferId}, partNumber=${part.partNumber}, status=${response.status}`);
  }

  return eTag;
}

async function uploadSignedPart(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  part: PlannedUploadPart,
  blob: Blob,
  heartbeat: MediaUploadClaimHeartbeat,
): Promise<UploadedMediaPart> {
  let attemptNumber = 1;
  while (true) {
    try {
      const partUrl = await loadPartUrl(transfer, sessionId, part);
      await heartbeat.throwIfFailed();
      return {
        partNumber: part.partNumber,
        eTag: await uploadSignedPartOnce(transfer, partUrl, part, blob),
        sha256: part.sha256,
      };
    } catch (error) {
      if (error instanceof RetryableMediaUploadError === false || attemptNumber >= signedPartUploadMaximumAttemptCount) {
        throw error;
      }

      warnSignedPartUploadRetry(transfer, part.partNumber, attemptNumber, error);
      await waitForSignedPartUploadRetry();
      attemptNumber += 1;
    }
  }
}

function getPartUrl(
  partUrls: ReadonlyArray<MediaAssetUploadPartUrl>,
  part: PlannedUploadPart,
  transfer: MediaTransferQueueRecord,
): MediaAssetUploadPartUrl {
  const matchingPartUrls = partUrls.filter((partUrl) => partUrl.partNumber === part.partNumber);
  if (matchingPartUrls.length !== 1) {
    throw new PermanentMediaUploadError(`Media upload part URL response mismatch: transferId=${transfer.transferId}, partNumber=${part.partNumber}, matchingUrlCount=${matchingPartUrls.length}`);
  }

  return matchingPartUrls[0];
}

async function loadPartUrls(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  parts: ReadonlyArray<PlannedUploadPart>,
): Promise<ReadonlyArray<MediaAssetUploadPartUrl>> {
  const response = await createMediaAssetUploadPartUrls(transfer.workspaceId, sessionId, {
    parts: parts.map((part) => ({
      partNumber: part.partNumber,
      sha256: part.sha256,
    })),
  });
  if (response.sessionId !== sessionId) {
    throw new PermanentMediaUploadError(`Media upload part URL session mismatch: transferId=${transfer.transferId}, expectedSessionId=${sessionId}, actualSessionId=${response.sessionId}`);
  }

  return parts.map((part) => getPartUrl(response.partUrls, part, transfer));
}

async function loadPartUrl(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  part: PlannedUploadPart,
): Promise<MediaAssetUploadPartUrl> {
  const [partUrl] = await loadPartUrls(transfer, sessionId, [part]);
  if (partUrl === undefined) {
    throw new PermanentMediaUploadError(`Media upload part URL response was empty: transferId=${transfer.transferId}, partNumber=${part.partNumber}`);
  }

  return partUrl;
}

async function uploadParts(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
  parts: ReadonlyArray<PlannedUploadPart>,
  blob: Blob,
  heartbeat: MediaUploadClaimHeartbeat,
): Promise<ReadonlyArray<UploadedMediaPart>> {
  const uploadedParts: Array<UploadedMediaPart> = [];
  for (const part of parts) {
    await heartbeat.throwIfFailed();
    uploadedParts.push(await uploadSignedPart(transfer, uploadSession.sessionId, part, blob, heartbeat));
  }

  return uploadedParts;
}

function toCompleteParts(uploadedParts: ReadonlyArray<UploadedMediaPart>): ReadonlyArray<CompleteMediaAssetUploadPartInput> {
  return uploadedParts.map((part) => ({
    partNumber: part.partNumber,
    eTag: part.eTag,
    sha256: part.sha256,
  }));
}

async function abortUploadSessionAfterFailure(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
): Promise<unknown | null> {
  try {
    await abortMediaAssetUploadSession(transfer.workspaceId, sessionId);
    return null;
  } catch (error) {
    warnUploadSessionAbortFailure(transfer, sessionId, error);
    return error;
  }
}

async function runMultipartUploadSession(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
  verifiedBytes: VerifiedUploadBytes,
  heartbeat: MediaUploadClaimHeartbeat,
): Promise<MediaAsset> {
  try {
    const parts = await buildPlannedUploadParts(transfer, uploadSession, verifiedBytes.bytes);
    const uploadedParts = await uploadParts(transfer, uploadSession, parts, verifiedBytes.blob, heartbeat);
    await heartbeat.throwIfFailed();
    const result = await completeMediaAssetUploadSession(transfer.workspaceId, uploadSession.sessionId, {
      parts: toCompleteParts(uploadedParts),
    });
    assertUploadedMediaAssetMatchesTransfer(transfer, result.mediaAsset);
    return result.mediaAsset;
  } catch (error) {
    const abortError = await abortUploadSessionAfterFailure(transfer, uploadSession.sessionId);
    throw combineUploadFailureWithAbortFailure(error, abortError);
  }
}

async function uploadClaimedMediaTransfer(
  transfer: MediaTransferQueueRecord,
  installationId: string,
  heartbeat: MediaUploadClaimHeartbeat,
): Promise<MediaAsset> {
  const lastModifiedByReplicaId = await buildClientWorkspaceReplicaId(transfer.workspaceId, installationId);
  const sessionCreateResult = await createMediaAssetUploadSession(
    transfer.workspaceId,
    buildUploadSessionCreateInput(transfer, lastModifiedByReplicaId),
  );
  assertUploadSessionCreateResultMatchesTransfer(transfer, sessionCreateResult);
  if (sessionCreateResult.status === "already_available") {
    assertUploadedMediaAssetMatchesTransfer(transfer, sessionCreateResult.mediaAsset);
    return sessionCreateResult.mediaAsset;
  }

  let verifiedBytes: VerifiedUploadBytes;
  try {
    verifiedBytes = await loadVerifiedUploadBytes(transfer);
  } catch (error) {
    const abortError = await abortUploadSessionAfterFailure(transfer, sessionCreateResult.uploadSession.sessionId);
    throw combineUploadFailureWithAbortFailure(error, abortError);
  }

  return runMultipartUploadSession(transfer, sessionCreateResult.uploadSession, verifiedBytes, heartbeat);
}

async function processClaimedUploadTransfer(
  transfer: MediaTransferQueueRecord,
  installationId: string,
): Promise<void> {
  const heartbeat = startUploadClaimHeartbeat(transfer);
  try {
    const mediaAsset = await uploadClaimedMediaTransfer(transfer, installationId, heartbeat);
    const heartbeatError = await heartbeat.stop();
    if (heartbeatError !== null) {
      throw heartbeatError;
    }

    await putMediaAsset(mediaAsset);
    await markClaimedMediaTransferSucceeded({
      transferId: transfer.transferId,
      kind: "upload",
      expectedClaimedAt: heartbeat.getClaimedAt(),
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const heartbeatError = await heartbeat.stop();
    const failureError = heartbeatError ?? error;
    if (isAuthRedirectError(failureError)) {
      await markAuthRedirectUploadTransferRetryable(transfer, heartbeat.getClaimedAt());
      throw failureError;
    }

    await markUploadTransferFailed(transfer, heartbeat.getClaimedAt(), failureError);
  }
}

export async function processDueMediaUploadTransfersForWorkspace(workspaceId: string): Promise<void> {
  if (isBrowserOnline() === false) {
    return;
  }

  const cloudSettings = await loadCloudSettings();
  if (
    cloudSettings === null
    || cloudSettings.cloudState !== "linked"
    || cloudSettings.linkedWorkspaceId !== workspaceId
  ) {
    return;
  }

  const installationId = requireCloudInstallationId(cloudSettings);
  await recoverStaleUploadTransferClaims(workspaceId, new Date().toISOString());
  while (true) {
    const transfer = await claimNextDueMediaTransferByKind(workspaceId, "upload", new Date().toISOString());
    if (transfer === null) {
      return;
    }

    await processClaimedUploadTransfer(transfer, installationId);
  }
}
