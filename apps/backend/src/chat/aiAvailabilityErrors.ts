import { HttpError } from "../errors";

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

function asRecord(value: unknown): ErrorRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as ErrorRecord;
}

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

function readNumberField(record: ErrorRecord | null, fieldName: string): number | null {
  if (record === null) {
    return null;
  }

  const value = record[fieldName];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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

function statusFromError(error: unknown): number | null {
  const record = asRecord(error);
  return readNumberField(record, "status") ?? readNumberField(record, "statusCode");
}

function requestIdFromError(error: unknown): string | null {
  const record = asRecord(error);
  return readStringField(record, "requestID")
    ?? readStringField(record, "requestId")
    ?? readStringField(record, "request_id");
}

function upstreamMessageFromError(error: unknown): string | null {
  const record = asRecord(error);
  return readStringField(record, "message");
}

function messageIncludesProviderAuthFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /authentication|unauthorized|invalid api key|invalid x-api-key|permission/i.test(message);
}

function messageIncludesRateLimitFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /rate limit|too many requests|quota|insufficient credits?|billing|credit balance/i.test(message);
}

function messageIncludesUnavailableFailure(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /timeout|timed out|network|socket hang up|connection reset|connection refused|service unavailable|overloaded|temporarily unavailable|unavailable/i.test(message);
}

function messageIncludesMissingConfiguration(message: string | null): boolean {
  if (message === null) {
    return false;
  }

  return /(api key|credential|credentials|secret|token).*(not set|missing|required)/i.test(message);
}

function configuredMessage(kind: AIEndpointKind): string {
  if (kind === "chat") {
    return "AI chat is not configured on this server.";
  }

  return "AI audio transcription is not configured on this server.";
}

function unavailableMessage(kind: AIEndpointKind): string {
  if (kind === "chat") {
    return "AI chat is temporarily unavailable on this server. Try again later.";
  }

  return "AI audio transcription is temporarily unavailable on this server. Try again later.";
}

function notConfiguredCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_NOT_CONFIGURED" : "CHAT_TRANSCRIPTION_NOT_CONFIGURED";
}

function unavailableCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_UNAVAILABLE" : "CHAT_TRANSCRIPTION_UNAVAILABLE";
}

function rateLimitedCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_RATE_LIMITED" : "CHAT_TRANSCRIPTION_RATE_LIMITED";
}

function providerAuthCode(kind: AIEndpointKind): string {
  return kind === "chat" ? "LOCAL_CHAT_PROVIDER_AUTH_FAILED" : "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED";
}

/**
 * Extract provider-facing failure metadata once so chat and transcription
 * normalization can log the same upstream details without exposing them to
 * end users.
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
 * Build the stable "not configured" response used when a deployment omits AI
 * provider credentials. Clients should key off the returned `code`, not the
 * raw server text.
 */
export function makeAIEndpointNotConfiguredError(kind: AIEndpointKind): HttpError {
  return new HttpError(
    503,
    configuredMessage(kind),
    notConfiguredCode(kind),
  );
}

/**
 * Normalize provider and configuration failures into a small contract that is
 * safe to surface in clients. Provider-specific details remain available only
 * through the returned metadata for structured logging.
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
