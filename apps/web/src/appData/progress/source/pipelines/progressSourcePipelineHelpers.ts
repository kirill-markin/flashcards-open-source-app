import type { Dispatch, MutableRefObject } from "react";
import {
  ApiContractError,
  ApiError,
  isAuthRedirectError,
} from "../../../../api";
import { captureApiContractError } from "../../../../observability/apiContractObservation";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import {
  captureWebException,
  normalizeCaughtError,
  type ProgressServerLoadFailureDetails,
  type WebObservationScope,
} from "../../../../observability/webObservability";
import type { ProgressScopeKey } from "../../../../types";
import type { ProgressSourceAction } from "../../state/progressReducer";

export type ProgressSourceDispatch = Dispatch<ProgressSourceAction>;

export type ProgressCanLoadServerBaseRef = MutableRefObject<boolean>;

export type ProgressScopeKeyRef = MutableRefObject<ProgressScopeKey | null>;

export type ProgressNumberRef = MutableRefObject<number>;

export type ProgressServerLoadOperation = ProgressServerLoadFailureDetails["operation"];

export type ProgressLocalLoadOperation =
  | "progress_summary_local_load"
  | "progress_series_local_load"
  | "progress_review_schedule_local_load"
  | "progress_leaderboard_local_load";

export type ProgressServerLoadObservationContext = Readonly<{
  operation: ProgressServerLoadOperation;
  workspaceId: string | null;
  installationId: string | null;
}>;

type ApiErrorMetadataCarrier = Readonly<{
  requestId?: unknown;
  statusCode?: unknown;
  code?: unknown;
}>;

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeProgressSourceError(error: unknown): Error {
  return normalizeCaughtError(error);
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readErrorRequestId(error: Error): string | null {
  const requestId = (error as ApiErrorMetadataCarrier).requestId;
  return typeof requestId === "string" && requestId.trim() !== "" ? requestId : null;
}

function readErrorStatusCode(error: Error): number | null {
  const statusCode = (error as ApiErrorMetadataCarrier).statusCode;
  return typeof statusCode === "number" && Number.isFinite(statusCode) ? statusCode : null;
}

function readErrorCode(error: Error): string | null {
  const code = (error as ApiErrorMetadataCarrier).code;
  return typeof code === "string" && code.trim() !== "" ? code : null;
}

function buildProgressServerErrorScope(
  error: Error,
  context: ProgressServerLoadObservationContext,
): WebObservationScope {
  return {
    app: "web",
    feature: "progress",
    userId: null,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
    route: getCurrentRoute(),
    requestId: readErrorRequestId(error),
    statusCode: readErrorStatusCode(error),
    code: readErrorCode(error),
  };
}

function captureProgressServerException(error: Error, context: ProgressServerLoadObservationContext): void {
  captureWebException({
    action: "progress_server_load_failed",
    error,
    scope: buildProgressServerErrorScope(error, context),
    details: {
      operation: context.operation,
      workspaceId: context.workspaceId,
    },
  });
}

function isExpectedProgressProductErrorCode(code: string | null): boolean {
  switch (code) {
    case "ACCOUNT_DELETED":
    case "AUTH_UNAUTHORIZED":
    case "GUEST_AUTH_INVALID":
    case "PROGRESS_FROM_INVALID":
    case "PROGRESS_FROM_REQUIRED":
    case "PROGRESS_HUMAN_AUTH_REQUIRED":
    case "PROGRESS_RANGE_INVALID":
    case "PROGRESS_RANGE_TOO_LARGE":
    case "PROGRESS_TIMEZONE_INVALID":
    case "PROGRESS_TIMEZONE_REQUIRED":
    case "PROGRESS_TO_INVALID":
    case "PROGRESS_TO_REQUIRED":
    case "SESSION_CSRF_TOKEN_INVALID":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return false;
}

function isExpectedProgressValidationError(error: ApiError): boolean {
  return error.statusCode === 400
    && error.code === null
    && error.responseBodyKind === "json";
}

function shouldCaptureProgressServerLoadError(error: Error): boolean {
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

    if (isExpectedProgressProductErrorCode(error.code)) {
      return false;
    }

    if (error.statusCode === 401) {
      return false;
    }

    if (isExpectedProgressValidationError(error)) {
      return false;
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return true;
    }
  }

  return true;
}

export function captureProgressServerLoadError(error: Error, context: ProgressServerLoadObservationContext): boolean {
  if (shouldCaptureProgressServerLoadError(error) === false) {
    return false;
  }

  if (error instanceof ApiContractError) {
    captureApiContractError(error, {
      feature: "progress",
      sourceAction: context.operation,
      userId: null,
      workspaceId: context.workspaceId,
      installationId: context.installationId,
    });
    return true;
  }

  captureProgressServerException(error, context);
  return true;
}

export function captureProgressLocalLoadError(
  error: unknown,
  context: Readonly<{
    operation: ProgressLocalLoadOperation;
    workspaceId: string | null;
    installationId: string | null;
  }>,
): boolean {
  return captureAppOperationError(error, {
    feature: "progress",
    operation: context.operation,
    userId: null,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
    entityId: null,
  });
}
