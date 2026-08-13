import {
  createMediaAssetUploadSession,
  isAuthRedirectError,
  type ApiError,
} from "../../../api";
import { putMediaAsset } from "../../../localDb/mediaAssets";
import {
  loadMediaBlobCacheRecord,
  markClaimedMediaTransferSucceeded,
  type MediaBlobCacheRecord,
  type MediaTransferQueueRecord,
} from "../../../localDb/mediaTransfers";
import { isIndexedDbOpenRecoveryError } from "../../../localDb/core/indexedDbOpenRecovery";
import { loadCloudSettings } from "../../../localDb/sync/cloudSettings";
import type {
  MediaAsset,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadSession,
} from "../../../types";
import { requireCloudInstallationId } from "../local/syncCloudSettings";
import {
  claimNextDueUploadTransfer,
  markAuthRedirectUploadTransferRetryable,
  markUploadTransferCompletionTerminal,
  markUploadTransferFailed,
  normalizeMediaUploadError,
  PermanentMediaUploadError,
  recoverStaleUploadTransferClaims,
  startUploadClaimHeartbeat,
  throwIfUploadLifecycleCancelled,
  type MediaUploadClaimHeartbeat,
} from "./mediaUploadClaimLifecycle";
import {
  abortUploadSessionAfterFailure,
  combineUploadFailureWithAbortFailure,
  completeMultipartUploadSession,
  isSameSessionCompletionRetryError,
  MediaUploadCompletionTerminalError,
  type MediaUploadCompletionResult,
} from "./multipartCompletion";
import {
  uploadParts,
  type PlannedUploadPart,
} from "./signedPartUpload";

type VerifiedUploadBytes = Readonly<{
  bytes: Uint8Array;
  blob: Blob;
}>;

const browserMediaUploadPartSizeBytes = 8 * 1024 * 1024;

function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
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

async function runMultipartUploadSession(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
  verifiedBytes: VerifiedUploadBytes,
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
): Promise<MediaUploadCompletionResult> {
  try {
    const parts = await buildPlannedUploadParts(transfer, uploadSession, verifiedBytes.bytes);
    const uploadedParts = await uploadParts(
      transfer,
      uploadSession,
      parts,
      verifiedBytes.blob,
      heartbeat,
      signal,
    );
    const result = await completeMultipartUploadSession(
      transfer,
      uploadSession,
      uploadedParts,
      heartbeat,
      signal,
    );
    try {
      assertUploadedMediaAssetMatchesTransfer(transfer, result.mediaAsset);
    } catch (error) {
      if (isIndexedDbOpenRecoveryError(error)) {
        throw error;
      }

      if (result.retryableCompletionCause !== null) {
        throw new MediaUploadCompletionTerminalError(
          "interrupted",
          result.retryableCompletionCause,
          normalizeMediaUploadError(error),
        );
      }
      throw error;
    }
    return result;
  } catch (error) {
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }

    if (
      error instanceof MediaUploadCompletionTerminalError
      || isSameSessionCompletionRetryError(error)
    ) {
      throw error;
    }

    const abortError = await abortUploadSessionAfterFailure(transfer, uploadSession.sessionId);
    throw combineUploadFailureWithAbortFailure(error, abortError);
  }
}

async function uploadClaimedMediaTransfer(
  transfer: MediaTransferQueueRecord,
  installationId: string,
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
): Promise<MediaUploadCompletionResult> {
  const lastModifiedByReplicaId = await buildClientWorkspaceReplicaId(transfer.workspaceId, installationId);
  const sessionCreateResult = await createMediaAssetUploadSession(
    transfer.workspaceId,
    buildUploadSessionCreateInput(transfer, lastModifiedByReplicaId),
    signal,
  );
  assertUploadSessionCreateResultMatchesTransfer(transfer, sessionCreateResult);
  if (sessionCreateResult.status === "already_available") {
    assertUploadedMediaAssetMatchesTransfer(transfer, sessionCreateResult.mediaAsset);
    return {
      mediaAsset: sessionCreateResult.mediaAsset,
      retryableCompletionCause: null,
    };
  }

  let verifiedBytes: VerifiedUploadBytes;
  try {
    verifiedBytes = await loadVerifiedUploadBytes(transfer);
  } catch (error) {
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }

    const abortError = await abortUploadSessionAfterFailure(transfer, sessionCreateResult.uploadSession.sessionId);
    throw combineUploadFailureWithAbortFailure(error, abortError);
  }

  return runMultipartUploadSession(
    transfer,
    sessionCreateResult.uploadSession,
    verifiedBytes,
    heartbeat,
    signal,
  );
}

async function processClaimedUploadTransfer(
  transfer: MediaTransferQueueRecord,
  installationId: string,
  signal: AbortSignal,
): Promise<void> {
  const heartbeat = startUploadClaimHeartbeat(transfer);
  let retryableCompletionCause: ApiError | null = null;
  try {
    const result = await uploadClaimedMediaTransfer(transfer, installationId, heartbeat, signal);
    retryableCompletionCause = result.retryableCompletionCause;
    const heartbeatError = await heartbeat.stop();
    if (heartbeatError !== null) {
      throw heartbeatError;
    }

    throwIfUploadLifecycleCancelled(signal);
    await putMediaAsset(result.mediaAsset);
    throwIfUploadLifecycleCancelled(signal);
    await markClaimedMediaTransferSucceeded({
      transferId: transfer.transferId,
      kind: "upload",
      expectedClaimedAt: heartbeat.getClaimedAt(),
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const heartbeatError = await heartbeat.stop();
    if (isIndexedDbOpenRecoveryError(error)) {
      throw error;
    }
    if (isIndexedDbOpenRecoveryError(heartbeatError)) {
      throw heartbeatError;
    }

    const interruptionError = heartbeatError ?? error;
    const failureError = error instanceof MediaUploadCompletionTerminalError
      ? error
      : retryableCompletionCause === null
        ? interruptionError
        : new MediaUploadCompletionTerminalError(
            "interrupted",
            retryableCompletionCause,
            normalizeMediaUploadError(interruptionError),
          );
    if (isAuthRedirectError(failureError)) {
      await markAuthRedirectUploadTransferRetryable(transfer, heartbeat.getClaimedAt());
      throw failureError;
    }

    if (failureError instanceof MediaUploadCompletionTerminalError) {
      await markUploadTransferCompletionTerminal(transfer, failureError);
      return;
    }
    await markUploadTransferFailed(transfer, heartbeat.getClaimedAt(), failureError);
  }
}

export async function processDueMediaUploadTransfersForWorkspace(
  workspaceId: string,
  signal: AbortSignal,
): Promise<void> {
  if (isBrowserOnline() === false || signal.aborted) {
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
    if (signal.aborted) {
      return;
    }
    const transfer = await claimNextDueUploadTransfer(workspaceId, new Date().toISOString());
    if (transfer === null) {
      return;
    }

    await processClaimedUploadTransfer(transfer, installationId, signal);
  }
}
