import OpenAI from "openai";
import {
  chatAttachmentUnsupportedTypeMessage,
  isChatAttachmentUnsupportedTypeError,
} from "../attachmentPolicy";
import {
  CHAT_PROVIDER_TERMINAL_EVENT_ERROR_NAME,
  createProviderTerminalEventError,
  getAIProviderFailureMetadata,
} from "../providerFailure";
import {
  getErrorLogContext,
} from "../../server/logging";
import type {
  ChatWorkerLifecycleDetails,
} from "../../observability/sentry";

const GENERIC_RUNTIME_ERROR_MESSAGE = "The AI response failed before it could finish. Please try again.";
const PROVIDER_ERROR_MESSAGE = "The AI service could not complete the response. Please try again.";
const PROVIDER_AUTH_ERROR_MESSAGE = "The AI service could not authenticate the request. Please try again later.";
const PROVIDER_RATE_LIMITED_ERROR_MESSAGE = "The AI service is rate limited right now. Please try again in a few minutes.";
const PROVIDER_UNAVAILABLE_ERROR_MESSAGE = "The AI service is temporarily unavailable. Please try again soon.";
const PROVIDER_ABORT_ERROR_MESSAGE = "The AI request was interrupted. Please try again.";
const PROVIDER_CONTEXT_LENGTH_ERROR_MESSAGE = "This conversation has grown too long for the AI to continue. Please start a new chat to keep going.";
const PROVIDER_ERROR_TYPE_MAX_LENGTH = 128;
const PROVIDER_ERROR_PARAM_MAX_LENGTH = 256;
const MISSING_PROVIDER_FINGERPRINT_COMPONENT = "none";
const STREAM_ENUM_LIKE_VALUE_MAX_LENGTH = 128;

type SafeProviderErrorDetails = Pick<
  ChatWorkerLifecycleDetails,
  | "providerErrorClass"
  | "providerErrorMessage"
  | "providerErrorStatus"
  | "providerErrorCode"
  | "providerErrorType"
  | "providerErrorParam"
  | "providerErrorCategory"
  | "providerRequestId"
  | "streamResponseId"
  | "streamEventCount"
  | "streamLastEventType"
  | "streamSawIncompleteEvent"
  | "streamSawFailedEvent"
  | "streamedTextLength"
>;

type SafeProviderStreamDiagnostics = Pick<
  ChatWorkerLifecycleDetails,
  | "streamResponseId"
  | "streamEventCount"
  | "streamLastEventType"
  | "streamSawIncompleteEvent"
  | "streamSawFailedEvent"
  | "streamedTextLength"
>;

const MISSING_STREAM_DIAGNOSTICS: SafeProviderStreamDiagnostics = {
  streamResponseId: null,
  streamEventCount: null,
  streamLastEventType: null,
  streamSawIncompleteEvent: null,
  streamSawFailedEvent: null,
  streamedTextLength: null,
};

type ChatTerminalWarningFingerprintDetails = Pick<
  ChatWorkerLifecycleDetails,
  | "providerErrorStatus"
  | "providerErrorCode"
  | "providerErrorType"
  | "providerErrorParam"
  | "providerErrorCategory"
>;

function readErrorRecordStringField(error: unknown, fieldName: string): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const value = (error as Readonly<Record<string, unknown>>)[fieldName];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

function normalizeProviderErrorType(value: string | null): string | null {
  if (
    value === null
    || value.length > PROVIDER_ERROR_TYPE_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }

  return value;
}

function normalizeProviderErrorParam(value: string | null): string | null {
  if (
    value === null
    || value.length > PROVIDER_ERROR_PARAM_MAX_LENGTH
    || !/^[A-Za-z0-9_.\[\]-]+$/.test(value)
  ) {
    return null;
  }

  return value.replace(/\[\d+\]/g, "[]");
}

function readStreamDiagnosticsRecord(error: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const value = (error as Readonly<Record<string, unknown>>).streamDiagnostics;
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function readStreamEnumLikeField(
  record: Readonly<Record<string, unknown>>,
  fieldName: string,
): string | null {
  const value = record[fieldName];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (
    trimmedValue === ""
    || trimmedValue.length > STREAM_ENUM_LIKE_VALUE_MAX_LENGTH
    || !/^[A-Za-z0-9_.-]+$/.test(trimmedValue)
  ) {
    return null;
  }

  return trimmedValue;
}

function readStreamCountField(
  record: Readonly<Record<string, unknown>>,
  fieldName: string,
): number | null {
  const value = record[fieldName];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readStreamFlagField(
  record: Readonly<Record<string, unknown>>,
  fieldName: string,
): boolean | null {
  const value = record[fieldName];
  return typeof value === "boolean" ? value : null;
}

/**
 * Lifts the stream-shape diagnostics an OpenAI loop terminal error carries into
 * the lifecycle payload. Every field is re-validated here rather than trusted,
 * so only counts, lengths and enum-like identifiers can ever reach the logs.
 */
function createSafeProviderStreamDiagnostics(error: unknown | null): SafeProviderStreamDiagnostics {
  const record = readStreamDiagnosticsRecord(error);
  if (record === null) {
    return MISSING_STREAM_DIAGNOSTICS;
  }

  return {
    streamResponseId: readStreamEnumLikeField(record, "streamResponseId"),
    streamEventCount: readStreamCountField(record, "streamEventCount"),
    streamLastEventType: readStreamEnumLikeField(record, "streamLastEventType"),
    streamSawIncompleteEvent: readStreamFlagField(record, "streamSawIncompleteEvent"),
    streamSawFailedEvent: readStreamFlagField(record, "streamSawFailedEvent"),
    streamedTextLength: readStreamCountField(record, "streamedTextLength"),
  };
}

function toProviderFingerprintComponent(value: string | number | null | undefined): string {
  return value === null || value === undefined
    ? MISSING_PROVIDER_FINGERPRINT_COMPONENT
    : String(value);
}

export function createChatTerminalWarningFingerprint(
  details: ChatTerminalWarningFingerprintDetails,
): readonly [string, string, string, string, string, string] {
  return [
    "chat_worker_terminal_state_persisted",
    toProviderFingerprintComponent(details.providerErrorCategory),
    toProviderFingerprintComponent(details.providerErrorStatus),
    toProviderFingerprintComponent(details.providerErrorCode),
    toProviderFingerprintComponent(details.providerErrorType),
    toProviderFingerprintComponent(details.providerErrorParam),
  ];
}

function classifyProviderErrorCategory(error: unknown, providerStatus: number | null): string | null {
  if (error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
    return "provider_abort";
  }

  if (error instanceof Error && error.name === CHAT_PROVIDER_TERMINAL_EVENT_ERROR_NAME) {
    return "provider_error";
  }

  if (providerStatus === 401 || providerStatus === 403) {
    return "provider_auth";
  }

  if (providerStatus === 402 || providerStatus === 429) {
    return "provider_rate_limited";
  }

  if (providerStatus !== null && providerStatus >= 500) {
    return "provider_unavailable";
  }

  if (providerStatus !== null || error instanceof OpenAI.APIError) {
    return "provider_error";
  }

  return error === null ? null : "runtime_error";
}

export function createSafeProviderErrorDetails(error: unknown | null): SafeProviderErrorDetails {
  if (error === null) {
    return {
      providerErrorClass: null,
      providerErrorMessage: null,
      providerErrorStatus: null,
      providerErrorCode: null,
      providerErrorType: null,
      providerErrorParam: null,
      providerErrorCategory: null,
      providerRequestId: null,
      ...MISSING_STREAM_DIAGNOSTICS,
    };
  }

  const errorContext = getErrorLogContext(error);
  const providerMetadata = getAIProviderFailureMetadata(error);

  return {
    providerErrorClass: errorContext.errorClass,
    providerErrorMessage: null,
    providerErrorStatus: providerMetadata.upstreamStatus,
    providerErrorCode: readErrorRecordStringField(error, "code"),
    providerErrorType: normalizeProviderErrorType(readErrorRecordStringField(error, "type")),
    providerErrorParam: normalizeProviderErrorParam(readErrorRecordStringField(error, "param")),
    providerErrorCategory: classifyProviderErrorCategory(error, providerMetadata.upstreamStatus),
    providerRequestId: providerMetadata.upstreamRequestId,
    ...createSafeProviderStreamDiagnostics(error),
  };
}

export function createPublicTerminalErrorMessage(error: unknown): string {
  const providerMetadata = getAIProviderFailureMetadata(error);
  const category = classifyProviderErrorCategory(error, providerMetadata.upstreamStatus);
  const providerErrorCode = readErrorRecordStringField(error, "code");

  if (isChatAttachmentRejectedError(error)) {
    return chatAttachmentUnsupportedTypeMessage;
  }

  if (providerErrorCode === "context_length_exceeded") {
    return PROVIDER_CONTEXT_LENGTH_ERROR_MESSAGE;
  }

  if (isProviderQuotaExhaustedError(error)) {
    return PROVIDER_UNAVAILABLE_ERROR_MESSAGE;
  }

  if (category === "provider_auth") {
    return PROVIDER_AUTH_ERROR_MESSAGE;
  }

  if (category === "provider_rate_limited") {
    return PROVIDER_RATE_LIMITED_ERROR_MESSAGE;
  }

  if (category === "provider_unavailable") {
    return PROVIDER_UNAVAILABLE_ERROR_MESSAGE;
  }

  if (category === "provider_abort") {
    return PROVIDER_ABORT_ERROR_MESSAGE;
  }

  if (category === "provider_error") {
    return PROVIDER_ERROR_MESSAGE;
  }

  return GENERIC_RUNTIME_ERROR_MESSAGE;
}

export function isHandledProviderFailure(error: unknown): boolean {
  if (isChatAttachmentUnsupportedTypeError(error)) {
    return true;
  }

  const providerMetadata = getAIProviderFailureMetadata(error);
  const category = classifyProviderErrorCategory(error, providerMetadata.upstreamStatus);
  return category !== null && category !== "runtime_error";
}

export { createProviderTerminalEventError } from "../providerFailure";

export function isUserAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || (error instanceof Error && error.name === "AbortError");
}

export function isContextLengthExceededError(error: unknown): boolean {
  return readErrorRecordStringField(error, "code") === "context_length_exceeded";
}

export function isChatAttachmentRejectedError(error: unknown): boolean {
  return isChatAttachmentUnsupportedTypeError(error)
    || readErrorRecordStringField(error, "code") === "invalid_file";
}

export function isProviderQuotaExhaustedError(error: unknown): boolean {
  return readErrorRecordStringField(error, "code") === "credit_balance_exhausted"
    || normalizeProviderErrorType(readErrorRecordStringField(error, "type")) === "insufficient_quota";
}
