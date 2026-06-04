import {
  ApiContractError,
  ApiError,
} from "../../../api";
import { getStableInstallationId } from "../../../clientIdentity";
import type { CloudSettings, SessionInfo, WorkspaceSummary } from "../../../types";
import {
  addWebBreadcrumb,
  captureWebException,
  normalizeCaughtError,
  type WebObservationFeature,
  type WebObservationScope,
  type WorkspaceActivationBootstrapPhase,
  type WorkspaceTransitionBreadcrumbDetails,
} from "../../../observability/webObservability";
import type { SessionVerificationState } from "../workspaceSessionTypes";

export type WorkspaceTransitionLogDetails = Readonly<{
  sessionVerificationState?: SessionVerificationState;
  isSessionVerified?: boolean;
  cloudState?: CloudSettings["cloudState"] | null;
  workspaceId?: string;
  deletedWorkspaceId?: string;
  replacementWorkspaceId?: string;
  selectedWorkspaceId?: string | null;
  activeWorkspaceId?: string | null;
  availableWorkspaceIds?: ReadonlyArray<string>;
  nextWorkspaceIds?: ReadonlyArray<string>;
  redirected?: boolean;
  errorMessage?: string;
  bootstrapPhase?: WorkspaceActivationBootstrapPhase;
  syncRunId?: string;
}>;

type WorkspaceTransitionEventName =
  | "session_bootstrap_redirected"
  | "workspace_activate_bootstrap_started"
  | "workspace_activate_bootstrap_deferred"
  | "workspace_activate_bootstrap_succeeded"
  | "workspace_activate_bootstrap_redirected"
  | "workspace_activate_started"
  | "workspace_activate_cloud_settings_saved"
  | "workspace_activate_published"
  | "workspace_select_client_started"
  | "workspace_select_client_succeeded"
  | "workspace_create_client_started"
  | "workspace_create_client_succeeded"
  | "workspace_delete_client_started"
  | "workspace_delete_client_succeeded"
  | "workspace_delete_client_preparing_activation"
  | "workspace_delete_client_redirected"
  | "workspace_management_interaction_blocked";

type WorkspaceTransitionFailureEventName =
  | "session_bootstrap_failed"
  | "session_account_switch_failed"
  | "workspace_activate_bootstrap_failed"
  | "workspace_select_client_failed"
  | "workspace_create_client_failed"
  | "workspace_delete_client_failed";

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getErrorRequestId(error: Error): string | null {
  return error instanceof ApiError || error instanceof ApiContractError ? error.requestId : null;
}

function getErrorStatusCode(error: Error): number | null {
  return error instanceof ApiError || error instanceof ApiContractError ? error.statusCode : null;
}

function getErrorCode(error: Error): string | null {
  return error instanceof ApiError || error instanceof ApiContractError ? error.code : null;
}

function getErrorSyncRunId(error: Error): string | null {
  if (typeof error !== "object" || error === null || "syncRunId" in error === false) {
    return null;
  }

  const syncRunId = (error as Readonly<{ syncRunId: unknown }>).syncRunId;
  return typeof syncRunId === "string" && syncRunId.trim() !== "" ? syncRunId : null;
}

function buildWorkspaceObservationScope(
  feature: WebObservationFeature,
  details: WorkspaceTransitionLogDetails,
  error: Error | null,
): WebObservationScope {
  return {
    app: "web",
    feature,
    userId: null,
    workspaceId: details.workspaceId ?? details.activeWorkspaceId ?? details.selectedWorkspaceId ?? null,
    installationId: getStableInstallationId(),
    route: getCurrentRoute(),
    requestId: error === null ? null : getErrorRequestId(error),
    statusCode: error === null ? null : getErrorStatusCode(error),
    code: error === null ? null : getErrorCode(error),
  };
}

function normalizeWorkspaceTransitionDetails(
  eventName: WorkspaceTransitionEventName,
  details: WorkspaceTransitionLogDetails,
): WorkspaceTransitionBreadcrumbDetails {
  return {
    eventName,
    sessionVerificationState: details.sessionVerificationState ?? null,
    isSessionVerified: details.isSessionVerified ?? null,
    cloudState: details.cloudState ?? null,
    workspaceId: details.workspaceId ?? null,
    deletedWorkspaceId: details.deletedWorkspaceId ?? null,
    replacementWorkspaceId: details.replacementWorkspaceId ?? null,
    selectedWorkspaceId: details.selectedWorkspaceId ?? null,
    activeWorkspaceId: details.activeWorkspaceId ?? null,
    availableWorkspaceIds: details.availableWorkspaceIds ?? [],
    nextWorkspaceIds: details.nextWorkspaceIds ?? [],
    redirected: details.redirected ?? false,
    errorMessage: details.errorMessage ?? null,
    bootstrapPhase: details.bootstrapPhase ?? null,
    syncRunId: details.syncRunId ?? null,
  };
}

export function logWorkspaceTransition(
  event: WorkspaceTransitionEventName,
  details: WorkspaceTransitionLogDetails,
): void {
  addWebBreadcrumb({
    action: "workspace_transition",
    scope: buildWorkspaceObservationScope("workspace", details, null),
    details: normalizeWorkspaceTransitionDetails(event, details),
  });
}

export function captureWorkspaceTransitionError(
  event: WorkspaceTransitionFailureEventName,
  details: WorkspaceTransitionLogDetails,
  caughtError: unknown,
): void {
  const error = normalizeCaughtError(caughtError);
  const syncRunId = details.syncRunId ?? getErrorSyncRunId(error);
  const scope = buildWorkspaceObservationScope(
    event === "session_bootstrap_failed" || event === "session_account_switch_failed" ? "auth" : "workspace",
    details,
    error,
  );

  if (error instanceof ApiContractError) {
    captureWebException({
      action: "api_contract_failed",
      error,
      scope,
      details: {
        endpoint: error.endpoint,
        fieldPath: error.fieldPath,
        expected: error.expected,
        sourceAction: event,
      },
    });
    return;
  }

  if (event === "session_bootstrap_failed") {
    captureWebException({
      action: "session_bootstrap_failed",
      error,
      scope,
      details: {
        operation: "session_bootstrap_failed",
        verificationState: details.sessionVerificationState ?? null,
      },
    });
    return;
  }

  if (event === "session_account_switch_failed") {
    captureWebException({
      action: "session_account_switch_failed",
      error,
      scope,
      details: {
        operation: "session_account_switch_failed",
        verificationState: details.sessionVerificationState ?? null,
      },
    });
    return;
  }

  captureWebException({
    action: "workspace_activation_failed",
    error,
    scope,
    details: {
      operation: event,
      workspaceId: details.workspaceId ?? details.activeWorkspaceId ?? details.selectedWorkspaceId ?? null,
      bootstrapPhase: details.bootstrapPhase ?? null,
      syncRunId,
    },
  });
}

export function buildWorkspaceInteractionLogDetails(
  sessionVerificationState: SessionVerificationState,
  session: SessionInfo | null,
  activeWorkspace: WorkspaceSummary | null,
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>,
  cloudSettings: CloudSettings | null,
  workspaceId: string | null,
  errorMessage: string | null,
): WorkspaceTransitionLogDetails {
  return {
    sessionVerificationState,
    isSessionVerified: sessionVerificationState === "verified",
    cloudState: cloudSettings?.cloudState ?? null,
    selectedWorkspaceId: session?.selectedWorkspaceId ?? null,
    activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
    workspaceId: workspaceId ?? undefined,
    availableWorkspaceIds: availableWorkspaces.map((workspace) => workspace.workspaceId),
    errorMessage: errorMessage ?? undefined,
  };
}
