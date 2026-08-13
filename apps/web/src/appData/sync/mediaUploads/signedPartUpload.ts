import { createMediaAssetUploadPartUrls } from "../../../api";
import type {
  MediaAssetUploadPartUrl,
  MediaAssetUploadSession,
} from "../../../types";
import type { MediaTransferQueueRecord } from "../../../localDb/mediaTransfers";
import {
  PermanentMediaUploadError,
  readErrorMessage,
  readErrorName,
  readUploadLifecycleCancellationError,
  RetryableMediaUploadError,
  type MediaUploadClaimHeartbeat,
} from "./mediaUploadClaimLifecycle";

export type PlannedUploadPart = Readonly<{
  partNumber: number;
  sha256: string;
  startByte: number;
  endByte: number;
}>;

export type UploadedMediaPart = Readonly<{
  partNumber: number;
  eTag: string;
  sha256: string;
}>;

const signedPartUploadMaximumAttemptCount = 2;
const signedPartUploadRetryDelayMs = 250;
const signedPartUrlExpirySafetyMarginMs = 60_000;
const signedPartUploadErrorBodyMaximumBytes = 4096;
const signedPartUploadErrorFieldMaximumLength = 128;

function isTransientStatusCode(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

async function waitForSignedPartUploadRetry(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timerId: number | null = null;
    const abortHandler = (): void => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      reject(readUploadLifecycleCancellationError(signal));
    };
    if (signal.aborted) {
      abortHandler();
      return;
    }

    timerId = window.setTimeout((): void => {
      signal.removeEventListener("abort", abortHandler);
      resolve();
    }, signedPartUploadRetryDelayMs);
    signal.addEventListener("abort", abortHandler, { once: true });
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

async function readSignedPartUploadFailureBodyText(
  response: Response,
  hasFailed: () => boolean,
): Promise<string | null> {
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
      if (hasFailed()) {
        return null;
      }
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
        if (hasFailed()) {
          return null;
        }
        break;
      }
    }
  } catch (error) {
    if (hasFailed()) {
      throw error;
    }
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

async function readSanitizedSignedPartUploadFailure(
  response: Response,
  hasFailed: () => boolean,
): Promise<SanitizedSignedPartUploadFailure | null> {
  const responseBody = await readSignedPartUploadFailureBodyText(response, hasFailed);
  if (hasFailed()) {
    return null;
  }
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

async function uploadSignedPartOnce(
  transfer: MediaTransferQueueRecord,
  partUrl: MediaAssetUploadPartUrl,
  part: PlannedUploadPart,
  blob: Blob,
  signal: AbortSignal,
  hasFailed: () => boolean,
): Promise<string | null> {
  if (hasFailed()) {
    return null;
  }
  assertSignedPartUrlUsable(transfer, partUrl, part);
  let response: Response;
  try {
    response = await fetch(partUrl.url, {
      method: partUrl.method,
      headers: partUrl.headers,
      body: blob.slice(part.startByte, part.endByte),
      signal,
    });
  } catch (error) {
    if (hasFailed()) {
      throw error;
    }
    throw new RetryableMediaUploadError(`Media upload part request failed: transferId=${transfer.transferId}, partNumber=${part.partNumber}, errorName=${readErrorName(error)}`);
  }
  if (hasFailed()) {
    return null;
  }

  if (response.ok === false) {
    const failure = await readSanitizedSignedPartUploadFailure(response, hasFailed);
    if (hasFailed() || failure === null) {
      return null;
    }
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
  signal: AbortSignal,
  hasFailed: () => boolean,
): Promise<ReadonlyArray<MediaAssetUploadPartUrl> | null> {
  if (hasFailed()) {
    return null;
  }
  const response = await createMediaAssetUploadPartUrls(transfer.workspaceId, sessionId, {
    parts: parts.map((part) => ({
      partNumber: part.partNumber,
      sha256: part.sha256,
    })),
  }, signal);
  if (hasFailed()) {
    return null;
  }
  if (response.sessionId !== sessionId) {
    throw new PermanentMediaUploadError(`Media upload part URL session mismatch: transferId=${transfer.transferId}, expectedSessionId=${sessionId}, actualSessionId=${response.sessionId}`);
  }

  return parts.map((part) => getPartUrl(response.partUrls, part, transfer));
}

async function loadPartUrl(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  part: PlannedUploadPart,
  signal: AbortSignal,
  hasFailed: () => boolean,
): Promise<MediaAssetUploadPartUrl | null> {
  const partUrls = await loadPartUrls(transfer, sessionId, [part], signal, hasFailed);
  if (hasFailed() || partUrls === null) {
    return null;
  }
  const [partUrl] = partUrls;
  if (partUrl === undefined) {
    throw new PermanentMediaUploadError(`Media upload part URL response was empty: transferId=${transfer.transferId}, partNumber=${part.partNumber}`);
  }

  return partUrl;
}

async function uploadSignedPart(
  transfer: MediaTransferQueueRecord,
  sessionId: string,
  part: PlannedUploadPart,
  blob: Blob,
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
  hasFailed: () => boolean,
): Promise<UploadedMediaPart | null> {
  let attemptNumber = 1;
  while (true) {
    if (hasFailed()) {
      return null;
    }
    try {
      const partUrl = await loadPartUrl(transfer, sessionId, part, signal, hasFailed);
      if (hasFailed() || partUrl === null) {
        return null;
      }
      await heartbeat.throwIfFailed();
      if (hasFailed()) {
        return null;
      }
      const eTag = await uploadSignedPartOnce(transfer, partUrl, part, blob, signal, hasFailed);
      if (hasFailed() || eTag === null) {
        return null;
      }
      return {
        partNumber: part.partNumber,
        eTag,
        sha256: part.sha256,
      };
    } catch (error) {
      if (hasFailed()) {
        throw error;
      }
      if (error instanceof RetryableMediaUploadError === false || attemptNumber >= signedPartUploadMaximumAttemptCount) {
        throw error;
      }

      warnSignedPartUploadRetry(transfer, part.partNumber, attemptNumber, error);
      await waitForSignedPartUploadRetry(signal);
      if (hasFailed()) {
        throw error;
      }
      attemptNumber += 1;
    }
  }
}

export async function uploadParts(
  transfer: MediaTransferQueueRecord,
  uploadSession: MediaAssetUploadSession,
  parts: ReadonlyArray<PlannedUploadPart>,
  blob: Blob,
  heartbeat: MediaUploadClaimHeartbeat,
  signal: AbortSignal,
  hasFailed: () => boolean,
): Promise<ReadonlyArray<UploadedMediaPart> | null> {
  const uploadedParts: Array<UploadedMediaPart> = [];
  for (const part of parts) {
    if (hasFailed()) {
      return null;
    }
    await heartbeat.throwIfFailed();
    if (hasFailed()) {
      return null;
    }
    const uploadedPart = await uploadSignedPart(
      transfer,
      uploadSession.sessionId,
      part,
      blob,
      heartbeat,
      signal,
      hasFailed,
    );
    if (hasFailed() || uploadedPart === null) {
      return null;
    }
    uploadedParts.push(uploadedPart);
  }

  return uploadedParts;
}
