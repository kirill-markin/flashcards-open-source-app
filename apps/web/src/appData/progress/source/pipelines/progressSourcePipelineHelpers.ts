import type { Dispatch, MutableRefObject } from "react";
import { ApiNetworkError } from "../../../../api";
import { captureApiContractError } from "../../../../observability/apiContractObservation";
import {
  captureWebException,
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

export type ProgressServerLoadObservationContext = Readonly<{
  operation: ProgressServerLoadOperation;
  workspaceId: string | null;
  installationId: string | null;
}>;

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildProgressNetworkErrorScope(
  error: ApiNetworkError,
  context: ProgressServerLoadObservationContext,
): WebObservationScope {
  return {
    app: "web",
    feature: "progress",
    userId: null,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
    route: getCurrentRoute(),
    requestId: error.requestId,
    statusCode: error.statusCode,
    code: error.code,
  };
}

function captureProgressNetworkError(error: unknown, context: ProgressServerLoadObservationContext): void {
  if (error instanceof ApiNetworkError === false) {
    return;
  }

  captureWebException({
    action: "progress_server_load_failed",
    error,
    scope: buildProgressNetworkErrorScope(error, context),
    details: {
      operation: context.operation,
      workspaceId: context.workspaceId,
    },
  });
}

export function captureProgressServerLoadError(error: unknown, context: ProgressServerLoadObservationContext): void {
  captureApiContractError(error, {
    feature: "progress",
    sourceAction: context.operation,
    userId: null,
    workspaceId: context.workspaceId,
    installationId: context.installationId,
  });
  captureProgressNetworkError(error, context);
}
