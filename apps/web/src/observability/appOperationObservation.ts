import { ApiContractError, ApiError, AuthRedirectError } from "../api";
import {
  captureWebException,
  normalizeCaughtError,
  type WebAppOperation,
  type WebObservationFeature,
  type WebObservationScope,
} from "./webObservability";

type AppOperationObservationContext = Readonly<{
  feature: WebObservationFeature;
  operation: WebAppOperation;
  userId: string | null;
  workspaceId: string | null;
  installationId: string | null;
  entityId: string | null;
  expectedErrorMessages?: ReadonlyArray<string>;
}>;

type ErrorMetadataCarrier = Readonly<{
  requestId?: unknown;
  redirectUrl?: unknown;
  statusCode?: unknown;
  code?: unknown;
}>;

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readStringMetadata(error: Error, key: keyof ErrorMetadataCarrier): string | null {
  const metadataValue = (error as ErrorMetadataCarrier)[key];
  return typeof metadataValue === "string" && metadataValue.trim() !== "" ? metadataValue : null;
}

function readNumberMetadata(error: Error, key: keyof ErrorMetadataCarrier): number | null {
  const metadataValue = (error as ErrorMetadataCarrier)[key];
  return typeof metadataValue === "number" && Number.isFinite(metadataValue) ? metadataValue : null;
}

function buildAppOperationScope(error: Error, context: AppOperationObservationContext): WebObservationScope {
  return {
    app: "web",
    feature: context.feature,
    userId: context.userId,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
    route: getCurrentRoute(),
    requestId: readStringMetadata(error, "requestId"),
    statusCode: readNumberMetadata(error, "statusCode"),
    code: readStringMetadata(error, "code"),
  };
}

function isExpectedAppProductErrorCode(code: string | null): boolean {
  switch (code) {
    case "ACCOUNT_DELETED":
    case "ACCOUNT_DELETE_CONFIRMATION_INVALID":
    case "ACCOUNT_DELETE_HUMAN_AUTH_REQUIRED":
    case "AGENT_API_KEY_HUMAN_SESSION_REQUIRED":
    case "AGENT_API_KEY_ID_INVALID":
    case "AGENT_API_KEY_ID_REQUIRED":
    case "AGENT_API_KEY_NOT_FOUND":
    case "AUTH_UNAUTHORIZED":
    case "GUEST_AUTH_INVALID":
    case "SESSION_CSRF_TOKEN_INVALID":
    case "WORKSPACE_DELETE_CONFIRMATION_INVALID":
    case "WORKSPACE_DELETE_SHARED":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_OWNER_REQUIRED":
    case "WORKSPACE_RESET_PROGRESS_CONFIRMATION_INVALID":
    case "WORKSPACE_RESET_SHARED":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return false;
}

function isExpectedAppValidationError(error: ApiError): boolean {
  return error.statusCode === 400
    && error.code === null
    && error.responseBodyKind === "json";
}

function isExpectedAppApiError(error: ApiError): boolean {
  if (error.statusCode >= 500) {
    return false;
  }

  if (isExpectedAppProductErrorCode(error.code)) {
    return true;
  }

  if (error.statusCode === 401) {
    return true;
  }

  return isExpectedAppValidationError(error);
}

function isExpectedAppOperationError(error: Error, context: AppOperationObservationContext): boolean {
  if (error instanceof ApiContractError) {
    return false;
  }

  if (error instanceof AuthRedirectError) {
    return true;
  }

  if (error instanceof ApiError) {
    return isExpectedAppApiError(error);
  }

  if (context.expectedErrorMessages?.includes(error.message) === true) {
    return true;
  }

  const redirectUrl = (error as ErrorMetadataCarrier).redirectUrl;
  if (typeof redirectUrl === "string" && redirectUrl.trim() !== "") {
    return true;
  }

  return error.message === "Browser session expired. Redirecting to sign in."
    || error.message === "Card front text must not be empty"
    || error.message === "Deck name must not be empty";
}

export function captureAppOperationError(caughtError: unknown, context: AppOperationObservationContext): void {
  const error = normalizeCaughtError(caughtError);
  if (isExpectedAppOperationError(error, context)) {
    return;
  }

  captureWebException({
    action: "app_operation_failed",
    error,
    scope: buildAppOperationScope(error, context),
    details: {
      operation: context.operation,
      entityId: context.entityId,
    },
  });
}
