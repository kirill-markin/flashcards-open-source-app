import { parseChatFileUploadResponse } from "../../apiContracts/chat";
import type {
  ChatFileUploadRequestBody,
  ChatFileUploadResponse,
  ChatFileUploadTarget,
} from "../../types";
import { parseContractResponse } from "../transport/response";
import {
  allowAuthRecoveryWithTransientNetworkRetry,
  requestJson,
} from "../transport/transport";
import { waitForTransportDelay } from "../transport/transportSignals";

const chatFileUploadPutMaximumAttemptCount = 3;
const chatFileUploadPutRetryDelayMs = 500;
const s3ErrorCodePattern = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/u;

/** The pre-signed PUT of a chat file upload failed; `statusCode` is null when no response arrived. */
export class ChatFileUploadTransferError extends Error {
  readonly statusCode: number | null;

  constructor(statusCode: number | null, message: string, cause: unknown) {
    super(message, { cause });
    this.name = "ChatFileUploadTransferError";
    this.statusCode = statusCode;
  }
}

/** Signs one PUT that stages the bytes a later `POST /chat` names in an `upload` part. */
export async function createChatFileUpload(body: ChatFileUploadRequestBody): Promise<ChatFileUploadResponse> {
  return parseContractResponse(await requestJson("/chat/files/uploads", {
    method: "POST",
    body: JSON.stringify(body),
  }, allowAuthRecoveryWithTransientNetworkRetry), "POST /chat/files/uploads", parseChatFileUploadResponse);
}

function isRetryableChatFileUploadStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function readErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function readS3ErrorCode(response: Response): Promise<string> {
  try {
    return s3ErrorCodePattern.exec(await response.text())?.[1] ?? "none";
  } catch (error) {
    throw new ChatFileUploadTransferError(
      response.status,
      `Chat file upload was rejected and its error body could not be read: status=${response.status}, errorName=${readErrorName(error)}`,
      error,
    );
  }
}

async function putChatFileUploadOnce(upload: ChatFileUploadTarget, body: Blob): Promise<void> {
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body,
    });
  } catch (error) {
    throw new ChatFileUploadTransferError(
      null,
      `Chat file upload request failed: sizeBytes=${body.size}, errorName=${readErrorName(error)}`,
      error,
    );
  }

  if (response.ok === false) {
    const errorCode = await readS3ErrorCode(response);
    throw new ChatFileUploadTransferError(
      response.status,
      `Chat file upload was rejected: status=${response.status}, errorCode=${errorCode}, sizeBytes=${body.size}`,
      null,
    );
  }
}

/** Sends `upload.headers` unchanged with the exact bytes: the signature binds their content type and length. */
export async function putChatFileUpload(upload: ChatFileUploadTarget, body: Blob): Promise<void> {
  for (let attemptCount = 1; ; attemptCount += 1) {
    try {
      await putChatFileUploadOnce(upload, body);
      return;
    } catch (error) {
      if (
        error instanceof ChatFileUploadTransferError === false
        || attemptCount >= chatFileUploadPutMaximumAttemptCount
        || (error.statusCode !== null && isRetryableChatFileUploadStatus(error.statusCode) === false)
      ) {
        throw error;
      }

      console.warn("Chat file upload retry", {
        attemptCount,
        maximumAttemptCount: chatFileUploadPutMaximumAttemptCount,
        statusCode: error.statusCode,
        errorMessage: error.message,
      });
      await waitForTransportDelay(chatFileUploadPutRetryDelayMs * attemptCount, null);
    }
  }
}
