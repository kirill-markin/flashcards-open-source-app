import {
  ApiContractError,
  ApiError,
  AuthRedirectError,
  ChatFileUploadTransferError,
} from "../../../api";
import { isBrowserApiNetworkError } from "../../../observability/apiNetworkErrorPolicy";
import {
  captureWebException,
  normalizeCaughtError,
  type ChatRunRequestFailureDetails,
  type ChatSnapshotFailureDetails,
  type WebObservationScope,
} from "../../../observability/webObservability";
import { AI_LIMIT_REACHED_CODE } from "../../shared/chatAiLimitPolicy";
import { isOwnOpenAIKeyError } from "../../shared/chatOwnOpenAIKeyErrorPolicy";
import {
  CHAT_ATTACHMENT_UNSUPPORTED_TYPE_CODE,
  isAiChatRequestTooLargeError,
  toChatAttachmentLimitViolation,
} from "../../shared/chatSizePolicy";

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildChatApiScope(workspaceId: string | null, error: Error): WebObservationScope {
  const hasApiMetadata = error instanceof ApiError || error instanceof ApiContractError;
  return {
    app: "web",
    feature: "chat",
    userId: null,
    workspaceId,
    installationId: null,
    route: getCurrentRoute(),
    requestId: hasApiMetadata ? error.requestId : null,
    statusCode: hasApiMetadata ? error.statusCode : null,
    code: hasApiMetadata ? error.code : null,
  };
}

function captureChatApiContractError(error: Error, workspaceId: string | null, sourceAction: string): boolean {
  if (error instanceof ApiContractError === false) {
    return false;
  }

  captureWebException({
    action: "api_contract_failed",
    error,
    scope: buildChatApiScope(workspaceId, error),
    details: {
      endpoint: error.endpoint,
      fieldPath: error.fieldPath,
      expected: error.expected,
      sourceAction,
    },
  });
  return true;
}

function isExpectedChatResponseError(error: ApiError): boolean {
  switch (error.code) {
    case "ACCOUNT_DELETED":
    case "AI_CHAT_V2_HUMAN_AUTH_REQUIRED":
    case "AUTH_UNAUTHORIZED":
    case "CHAT_ACTIVE_RUN_IN_PROGRESS":
    case "CHAT_SESSION_ID_CONFLICT":
    case "GUEST_AUTH_INVALID":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return error.statusCode === 401
    || (error.statusCode === 400 && error.code === null && error.responseBodyKind === "json");
}

function isExpectedChatRunResponseError(error: ApiError): boolean {
  return isAiChatRequestTooLargeError(error)
    || error.code === AI_LIMIT_REACHED_CODE
    || error.code === "BROWSER_GUEST_AI_TRIAL_QUOTA_REACHED"
    || error.code === "GUEST_WEB_AI_SIGN_IN_REQUIRED"
    || error.code === CHAT_ATTACHMENT_UNSUPPORTED_TYPE_CODE
    || toChatAttachmentLimitViolation(error.code) !== null
    || isOwnOpenAIKeyError(error.code)
    || isExpectedChatResponseError(error);
}

function isExpectedChatRequestError(error: Error, isExpectedResponseError: (error: ApiError) => boolean): boolean {
  if (error instanceof AuthRedirectError) {
    return true;
  }

  if (error instanceof ApiError === false || error.statusCode >= 500) {
    return false;
  }

  return isExpectedResponseError(error);
}

export function captureChatRunRequestError(caughtError: unknown, details: ChatRunRequestFailureDetails): void {
  const error = normalizeCaughtError(caughtError);
  if (captureChatApiContractError(error, details.workspaceId, details.operation)) {
    return;
  }

  // A PUT without a response is a connection failure. A response means storage refused a signed PUT.
  if (
    isBrowserApiNetworkError(error)
    || (error instanceof ChatFileUploadTransferError && error.statusCode === null)
    || isExpectedChatRequestError(error, isExpectedChatRunResponseError)
  ) {
    return;
  }

  captureWebException({
    action: "chat_run_request_failed",
    error,
    scope: buildChatApiScope(details.workspaceId, error),
    details,
  });
}

export function captureChatSnapshotError(caughtError: unknown, details: ChatSnapshotFailureDetails): void {
  const error = normalizeCaughtError(caughtError);
  if (
    captureChatApiContractError(error, details.workspaceId, details.trigger)
    || isExpectedChatRequestError(error, isExpectedChatResponseError)
  ) {
    return;
  }

  captureWebException({
    action: "chat_snapshot_failed",
    error,
    scope: buildChatApiScope(details.workspaceId, error),
    details,
  });
}
