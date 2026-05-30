import OpenAI from "openai";
import {
  chatAttachmentUnsupportedTypeMessage,
  isChatAttachmentUnsupportedTypeError,
} from "../attachmentPolicy";
import {
  getAIProviderFailureMetadata,
} from "../providerFailure";
import {
  getErrorLogContext,
} from "../../server/logging";
import type {
  ChatWorkerLifecycleDetails,
} from "../../observability/sentry";

const GENERIC_RUNTIME_ERROR_MESSAGE = "The AI response failed before it could finish. Please try again.";
const PROVIDER_ERROR_MESSAGE = "The AI provider could not complete the response. Please try again.";
const PROVIDER_AUTH_ERROR_MESSAGE = "The AI provider could not authenticate the request. Please try again later.";
const PROVIDER_RATE_LIMITED_ERROR_MESSAGE = "The AI provider is rate limited right now. Please try again in a few minutes.";
const PROVIDER_UNAVAILABLE_ERROR_MESSAGE = "The AI provider is temporarily unavailable. Please try again soon.";
const PROVIDER_ABORT_ERROR_MESSAGE = "The AI request was interrupted. Please try again.";

type SafeProviderErrorDetails = Pick<
  ChatWorkerLifecycleDetails,
  | "providerErrorClass"
  | "providerErrorMessage"
  | "providerErrorStatus"
  | "providerErrorCode"
  | "providerErrorCategory"
  | "providerRequestId"
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

function classifyProviderErrorCategory(error: unknown, providerStatus: number | null): string | null {
  if (error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
    return "provider_abort";
  }

  if (error instanceof Error && error.name === "ChatProviderTerminalEventError") {
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
      providerErrorCategory: null,
      providerRequestId: null,
    };
  }

  const errorContext = getErrorLogContext(error);
  const providerMetadata = getAIProviderFailureMetadata(error);

  return {
    providerErrorClass: errorContext.errorClass,
    providerErrorMessage: null,
    providerErrorStatus: providerMetadata.upstreamStatus,
    providerErrorCode: readErrorRecordStringField(error, "code"),
    providerErrorCategory: classifyProviderErrorCategory(error, providerMetadata.upstreamStatus),
    providerRequestId: providerMetadata.upstreamRequestId,
  };
}

export function createPublicTerminalErrorMessage(error: unknown): string {
  const providerMetadata = getAIProviderFailureMetadata(error);
  const category = classifyProviderErrorCategory(error, providerMetadata.upstreamStatus);
  const providerErrorCode = readErrorRecordStringField(error, "code");

  if (isChatAttachmentUnsupportedTypeError(error) || providerErrorCode === "invalid_file") {
    return chatAttachmentUnsupportedTypeMessage;
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

export function createProviderTerminalEventError(): Error {
  const error = new Error("Chat provider emitted a terminal error event");
  error.name = "ChatProviderTerminalEventError";
  return error;
}

export function isUserAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || (error instanceof Error && error.name === "AbortError");
}
