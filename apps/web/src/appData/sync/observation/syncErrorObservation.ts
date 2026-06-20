import {
  ApiContractError,
  ApiError,
  isAuthRedirectError,
} from "../../../api";
import { captureApiContractError } from "../../../observability/apiContractObservation";
import {
  captureWebException,
  type WebObservationScope,
} from "../../../observability/webObservability";

const workspaceNotFoundErrorCode = "WORKSPACE_NOT_FOUND";
const workspaceSyncDiscardedErrorName = "WorkspaceSyncDiscardedError";
const syncFailureCapturedProperty = "__flashcardsSyncFailureCaptured";

type SyncFailureCapturedCarrier = Readonly<{
  __flashcardsSyncFailureCaptured?: true;
}>;

export type WorkspaceSyncDiscardedError = Error & Readonly<{
  name: typeof workspaceSyncDiscardedErrorName;
  workspaceId: string;
}>;

export type SyncFailureObservationInput = Readonly<{
  error: Error;
  userId: string;
  workspaceId: string;
  installationId: string | null;
}>;

export function createWorkspaceSyncDiscardedError(workspaceId: string): WorkspaceSyncDiscardedError {
  const error = new Error(`Workspace sync was discarded: ${workspaceId}`);
  error.name = workspaceSyncDiscardedErrorName;
  return Object.assign(error, { workspaceId }) as WorkspaceSyncDiscardedError;
}

export function isWorkspaceSyncDiscardedError(error: unknown): error is WorkspaceSyncDiscardedError {
  return error instanceof Error
    && error.name === workspaceSyncDiscardedErrorName
    && "workspaceId" in error;
}

export function isWorkspaceNotFoundError(error: unknown): error is ApiError {
  return error instanceof ApiError
    && error.statusCode === 404
    && error.code === workspaceNotFoundErrorCode;
}

export function markSyncFailureCaptured(error: Error): void {
  Object.assign(error, {
    [syncFailureCapturedProperty]: true,
  });
}

export function isCapturedSyncFailure(error: unknown): boolean {
  return error instanceof Error
    && (error as SyncFailureCapturedCarrier)[syncFailureCapturedProperty] === true;
}

export function isExpectedUnobservedSyncFailure(error: unknown): boolean {
  return error instanceof Error
    && shouldCaptureUnexpectedSyncError(error) === false;
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildSyncObservationScope(
  error: Error,
  userId: string,
  workspaceId: string,
  installationId: string | null,
): WebObservationScope {
  const requestMetadata = error instanceof ApiError || error instanceof ApiContractError
    ? {
      requestId: error.requestId,
      statusCode: error.statusCode,
      code: error.code,
    }
    : {
      requestId: null,
      statusCode: null,
      code: null,
    };

  return {
    app: "web",
    feature: "sync",
    userId,
    workspaceId,
    installationId,
    route: getCurrentRoute(),
    requestId: requestMetadata.requestId,
    statusCode: requestMetadata.statusCode,
    code: requestMetadata.code,
  };
}

function isExpectedSyncProductErrorCode(code: string | null): boolean {
  switch (code) {
    case "ACCOUNT_DELETED":
    case "AUTH_UNAUTHORIZED":
    case "GUEST_AUTH_INVALID":
    case "SESSION_CSRF_TOKEN_INVALID":
    case "SYNC_BOOTSTRAP_NOT_EMPTY":
    case "SYNC_BOOTSTRAP_REQUIRED":
    case "SYNC_INVALID_INPUT":
    case "SYNC_WORKSPACE_FORK_REQUIRED":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return false;
}

function isExpectedSyncValidationError(error: ApiError): boolean {
  return error.statusCode === 400
    && error.code === null
    && error.responseBodyKind === "json";
}

function shouldCaptureUnexpectedSyncError(error: Error): boolean {
  if (error instanceof ApiContractError) {
    return true;
  }

  if (isAuthRedirectError(error)) {
    return false;
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      return true;
    }

    if (isExpectedSyncProductErrorCode(error.code)) {
      return false;
    }

    if (error.statusCode === 401) {
      return false;
    }

    if (isExpectedSyncValidationError(error)) {
      return false;
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return true;
    }
  }

  return true;
}

function captureUnexpectedSyncError(input: SyncFailureObservationInput): boolean {
  if (shouldCaptureUnexpectedSyncError(input.error) === false) {
    return false;
  }

  captureWebException({
    action: "sync_failed",
    error: input.error,
    scope: buildSyncObservationScope(
      input.error,
      input.userId,
      input.workspaceId,
      input.installationId,
    ),
    details: {
      operation: "sync_workspace_refresh",
      workspaceId: input.workspaceId,
    },
  });
  return true;
}

export function observeSyncFailure(input: SyncFailureObservationInput): boolean {
  const wasApiContractCaptured = captureApiContractError(input.error, {
    feature: "sync",
    sourceAction: "sync_workspace_refresh",
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
  });
  if (input.error instanceof ApiContractError) {
    return wasApiContractCaptured;
  }

  return captureUnexpectedSyncError(input);
}
