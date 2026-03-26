/**
 * Legacy chat backend error normalization for old `/chat/turn` clients.
 * The backend-first `/chat` endpoints classify and persist failures differently on the server.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import { HttpError } from "../../errors";

export type AIEndpointKind = "chat" | "transcription";

export type AIProviderFailureMetadata = Readonly<{
  upstreamStatus: number | null;
  upstreamRequestId: string | null;
  upstreamMessage: string | null;
  originalMessage: string;
}>;

export type AIEndpointFailureClassification = AIProviderFailureMetadata & Readonly<{
  statusCode: number;
  code: string;
  message: string;
  provider: string | null;
}>;

type ErrorRecord = Readonly<Record<string, unknown>>;

/**
 * This legacy chat backend helper coerces unknown provider errors into records for old `/chat/turn` flows.
 * The backend-first `/chat` stack reads and persists failure state differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function asRecord(value: unknown): ErrorRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as ErrorRecord;
}

/**
 * This legacy chat backend helper reads unknown provider failures as plain objects for old `/chat/turn` flows.
 * The backend-first `/chat` stack validates and persists failure state differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function readStringField(record: ErrorRecord | null, fieldName: string): string | null {
  if (record === null) {
    return null;
  }

  const value = record[fieldName];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

/**
 * This legacy chat backend helper reads numeric provider metadata for old `/chat/turn` flows.
 * The backend-first `/chat` stack derives and stores run failure metadata differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function readNumberField(record: ErrorRecord | null, fieldName: string): number | null {
  if (record === null) {
    return null;
  }

  const value = record[fieldName];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * This legacy chat backend helper normalizes provider error messages for old `/chat/turn` clients.
 * The backend-first `/chat` stack surfaces run failures through persisted session state instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const trimmedMessage = error.message.trim();
    return trimmedMessage === "" ? error.name : trimmedMessage;
  }

  if (typeof error === "string") {
    const trimmedMessage = error.trim();
    return trimmedMessage === "" ? "Unknown error" : trimmedMessage;
  }

  return String(error);
}

/**
 * This legacy chat backend helper extracts upstream status codes for old `/chat/turn` clients.
 * The backend-first `/chat` stack tracks provider failures through persisted runs instead of this legacy adapter.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function statusFromError(error: unknown): number | null {
  const record = asRecord(error);
  return readNumberField(record, "status") ?? readNumberField(record, "statusCode");
}

/**
 * This legacy chat backend helper extracts provider request identifiers for old `/chat/turn` clients.
 * The backend-first `/chat` stack stores request and run identifiers in server-owned chat records instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function requestIdFromError(error: unknown): string | null {
  const record = asRecord(error);
  return readStringField(record, "requestID")
    ?? readStringField(record, "requestId")
    ?? readStringField(record, "request_id");
}

/**
 * This legacy chat backend helper extracts raw upstream messages for old `/chat/turn` clients.
 * The backend-first `/chat` stack keeps normalized error state in persisted chat runs instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function upstreamMessageFromError(error: unknown): string | null {
  const record = asRecord(error);
  return readStringField(record, "message");
}

/**
 * This legacy chat backend helper recognizes provider auth failures for old `/chat/turn` clients.
 * The backend-first `/chat` stack handles provider failures through the server-owned run lifecycle instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function messageIncludesProviderAuthFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /authentication|unauthorized|invalid api key|invalid x-api-key|permission/i.test(message);
}

/**
 * This legacy chat backend helper recognizes rate-limit failures for old `/chat/turn` clients.
 * The backend-first `/chat` stack classifies these failures through persisted run state instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function messageIncludesRateLimitFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /rate limit|too many requests|quota|insufficient credits?|billing|credit balance/i.test(message);
}

/**
 * This legacy chat backend helper recognizes transient provider failures for old `/chat/turn` clients.
 * The backend-first `/chat` stack reports availability through the server-owned runtime and run records instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function messageIncludesUnavailableFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /timeout|timed out|network|socket hang up|connection reset|connection refused|service unavailable|overloaded|temporarily unavailable|unavailable/i.test(message);
}

/**
 * This legacy chat backend helper recognizes continuation failures in the old `/chat/turn` flow.
 * The backend-first `/chat` stack replays and resumes tool calls through persisted server state instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function messageIncludesContinuationFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /no tool output found for function call|function_call_output|tool output/i.test(message);
}

/**
 * This legacy chat backend helper recognizes missing provider configuration for old `/chat/turn` clients.
 * The backend-first `/chat` stack gates server-owned chat availability through its own configuration path instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function messageIncludesMissingConfiguration(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /(api key|credential|credentials|secret|token).*(not set|missing|required)/i.test(message);
}

/**
 * This legacy chat backend helper builds end-user configuration errors for the old `/chat/turn` surface.
 * The backend-first `/chat` endpoints expose their own server-owned availability contract instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function configuredMessage(kind: AIEndpointKind): string {
  if (kind === "chat") {
    return "AI chat is not configured on this server.";
  }

  return "AI audio transcription is not configured on this server.";
}

/**
 * This legacy chat backend helper builds transient availability errors for the old `/chat/turn` surface.
 * The backend-first `/chat` endpoints report runtime availability through persisted runs and session snapshots instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function unavailableMessage(kind: AIEndpointKind): string {
  if (kind === "chat") {
    return "AI chat is temporarily unavailable on this server. Try again later.";
  }

  return "AI audio transcription is temporarily unavailable on this server. Try again later.";
}

/**
 * This legacy chat backend helper maps old `/chat/turn` configuration failures to stable legacy error codes.
 * The backend-first `/chat` endpoints use a different server-owned error contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function notConfiguredCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_NOT_CONFIGURED" : "CHAT_TRANSCRIPTION_NOT_CONFIGURED";
}

/**
 * This legacy chat backend helper maps old `/chat/turn` availability failures to stable legacy error codes.
 * The backend-first `/chat` endpoints use a separate run-oriented error contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function unavailableCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_UNAVAILABLE" : "CHAT_TRANSCRIPTION_UNAVAILABLE";
}

/**
 * This legacy chat backend helper maps continuation failures in the old `/chat/turn` flow.
 * The backend-first `/chat` stack replaces this with persisted replay and recovery logic.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function continuationCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_CONTINUATION_FAILED" : unavailableCode(kind);
}

/**
 * This legacy chat backend helper maps rate-limit failures for old `/chat/turn` clients.
 * The backend-first `/chat` stack classifies provider pressure through server-owned runs instead.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function rateLimitedCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_RATE_LIMITED" : "CHAT_TRANSCRIPTION_RATE_LIMITED";
}

/**
 * This legacy chat backend helper maps provider-auth failures for old `/chat/turn` clients.
 * The backend-first `/chat` stack exposes different server-owned failure codes and recovery paths.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function providerAuthCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_PROVIDER_AUTH_FAILED" : "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED";
}

/**
 * This legacy chat backend entrypoint extracts provider-facing failure metadata for old `/chat/turn` and transcription flows.
 * The backend-first `/chat` stack stores and replays failure state differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function getAIProviderFailureMetadata(error: unknown): AIProviderFailureMetadata {
  return {
    upstreamStatus: statusFromError(error),
    upstreamRequestId: requestIdFromError(error),
    upstreamMessage: upstreamMessageFromError(error),
    originalMessage: getErrorMessage(error),
  };
}

/**
 * This legacy chat backend entrypoint builds the old "not configured" error contract for `/chat/turn` clients.
 * The backend-first `/chat` endpoints expose their own availability contract around server-owned sessions and runs.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function makeAIEndpointNotConfiguredError(kind: AIEndpointKind): HttpError {
  return new HttpError(
    503,
    configuredMessage(kind),
    notConfiguredCode(kind),
  );
}

/**
 * This legacy chat backend entrypoint normalizes provider failures for old `/chat/turn` clients.
 * The backend-first `/chat` stack handles failures through persisted run state and a different surface contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function classifyAIEndpointFailure(
  kind: AIEndpointKind,
  error: unknown,
  provider: string | null,
): AIEndpointFailureClassification {
  const metadata = getAIProviderFailureMetadata(error);
  const normalizedMessage = metadata.upstreamMessage ?? metadata.originalMessage;

  if (messageIncludesMissingConfiguration(normalizedMessage)) {
    return {
      ...metadata,
      statusCode: 503,
      code: notConfiguredCode(kind),
      message: configuredMessage(kind),
      provider,
    };
  }

  if (
    kind === "chat"
    && metadata.upstreamStatus === 400
    && messageIncludesContinuationFailure(normalizedMessage)
  ) {
    return {
      ...metadata,
      statusCode: 503,
      code: continuationCode(kind),
      message: unavailableMessage(kind),
      provider,
    };
  }

  if (
    metadata.upstreamStatus === 401
    || metadata.upstreamStatus === 403
    || messageIncludesProviderAuthFailure(normalizedMessage)
  ) {
    return {
      ...metadata,
      statusCode: 503,
      code: providerAuthCode(kind),
      message: unavailableMessage(kind),
      provider,
    };
  }

  if (
    metadata.upstreamStatus === 402
    || metadata.upstreamStatus === 429
    || messageIncludesRateLimitFailure(normalizedMessage)
  ) {
    return {
      ...metadata,
      statusCode: 429,
      code: rateLimitedCode(kind),
      message: unavailableMessage(kind),
      provider,
    };
  }

  if (
    (metadata.upstreamStatus !== null && metadata.upstreamStatus >= 500)
    || messageIncludesUnavailableFailure(normalizedMessage)
  ) {
    return {
      ...metadata,
      statusCode: 503,
      code: unavailableCode(kind),
      message: unavailableMessage(kind),
      provider,
    };
  }

  return {
    ...metadata,
    statusCode: 503,
    code: unavailableCode(kind),
    message: unavailableMessage(kind),
    provider,
  };
}
