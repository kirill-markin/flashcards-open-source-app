import { HttpError } from "../shared/errors";

export const CHAT_PROVIDER_TERMINAL_EVENT_ERROR_NAME = "ChatProviderTerminalEventError";

/**
 * Shape of the provider event stream behind a terminal failure, carried on the
 * error so the chat worker lifecycle payload can report what the stream had
 * produced before it died. Counts, lengths and enum-like strings only: never
 * provider text, prompt text or attachment content.
 */
export type ChatProviderStreamDiagnostics = Readonly<{
  streamResponseId: string | null;
  streamEventCount: number;
  streamLastEventType: string | null;
  streamSawIncompleteEvent: boolean;
  streamSawFailedEvent: boolean;
  streamedTextLength: number;
}>;

export type ChatProviderTerminalEventDetail = Readonly<{
  code?: string | null;
  message?: string | null;
  streamDiagnostics?: ChatProviderStreamDiagnostics | null;
}>;

type ChatProviderTerminalEventError = Error & Readonly<{
  code?: string;
  streamDiagnostics?: ChatProviderStreamDiagnostics;
}>;

function buildTerminalErrorMessage(detail: ChatProviderTerminalEventDetail | undefined): string {
  const trimmedMessage = typeof detail?.message === "string" ? detail.message.trim() : "";
  if (trimmedMessage !== "") {
    return trimmedMessage;
  }

  const trimmedCode = typeof detail?.code === "string" ? detail.code.trim() : "";
  if (trimmedCode !== "") {
    return `Chat provider emitted a terminal error event (${trimmedCode})`;
  }

  return "Chat provider emitted a terminal error event";
}

/**
 * Builds the shared terminal-event error so the OpenAI adapter and the runtime
 * executor produce the same classified `provider_error` without depending on
 * each other. The optional detail carries the real provider code/message; when
 * `detail.code` is set it is exposed as an own `code` property so
 * `createSafeProviderErrorDetails` can surface `providerErrorCode`, and
 * `detail.streamDiagnostics` is exposed the same way so it can surface the
 * stream shape.
 */
export function createProviderTerminalEventError(detail?: ChatProviderTerminalEventDetail): ChatProviderTerminalEventError {
  const error: ChatProviderTerminalEventError = new Error(buildTerminalErrorMessage(detail));
  error.name = CHAT_PROVIDER_TERMINAL_EVENT_ERROR_NAME;

  const streamDiagnostics = detail?.streamDiagnostics ?? null;
  const errorWithDiagnostics = streamDiagnostics === null
    ? error
    : Object.assign(error, { streamDiagnostics });

  const trimmedCode = typeof detail?.code === "string" ? detail.code.trim() : "";
  if (trimmedCode !== "") {
    return Object.assign(errorWithDiagnostics, { code: trimmedCode });
  }

  return errorWithDiagnostics;
}

export type AIProviderFailureMetadata = Readonly<{
  upstreamStatus: number | null;
  upstreamRequestId: string | null;
  upstreamMessage: string | null;
  originalMessage: string;
}>;

export type ChatTranscriptionFailureClassification = AIProviderFailureMetadata & Readonly<{
  statusCode: number;
  code: string;
  message: string;
  provider: "openai";
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

function makeTranscriptionUnavailableMessage(): string {
  return "AI audio transcription is temporarily unavailable on this server. Try again later.";
}

export function getAIProviderFailureMetadata(error: unknown): AIProviderFailureMetadata {
  return {
    upstreamStatus: statusFromError(error),
    upstreamRequestId: requestIdFromError(error),
    upstreamMessage: upstreamMessageFromError(error),
    originalMessage: getErrorMessage(error),
  };
}

export function makeChatTranscriptionNotConfiguredError(): HttpError {
  return new HttpError(
    503,
    "AI audio transcription is not configured on this server.",
    "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
  );
}

export function classifyChatTranscriptionFailure(error: unknown): ChatTranscriptionFailureClassification {
  const metadata = getAIProviderFailureMetadata(error);
  const normalizedMessage = metadata.upstreamMessage ?? metadata.originalMessage;

  if (messageIncludesMissingConfiguration(normalizedMessage)) {
    return {
      ...metadata,
      statusCode: 503,
      code: "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
      message: "AI audio transcription is not configured on this server.",
      provider: "openai",
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
      code: "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED",
      message: makeTranscriptionUnavailableMessage(),
      provider: "openai",
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
      code: "CHAT_TRANSCRIPTION_RATE_LIMITED",
      message: makeTranscriptionUnavailableMessage(),
      provider: "openai",
    };
  }

  if (
    (metadata.upstreamStatus !== null && metadata.upstreamStatus >= 500)
    || messageIncludesUnavailableFailure(normalizedMessage)
  ) {
    return {
      ...metadata,
      statusCode: 503,
      code: "CHAT_TRANSCRIPTION_UNAVAILABLE",
      message: makeTranscriptionUnavailableMessage(),
      provider: "openai",
    };
  }

  return {
    ...metadata,
    statusCode: 503,
    code: "CHAT_TRANSCRIPTION_UNAVAILABLE",
    message: makeTranscriptionUnavailableMessage(),
    provider: "openai",
  };
}
