import * as Sentry from "@sentry/react";
import type { Scope } from "@sentry/react";
import { isWebSentryEnabled } from "./instrument";

export type WebObservationFeature =
  | "auth"
  | "workspace"
  | "sync"
  | "chat"
  | "cards"
  | "review"
  | "progress"
  | "settings";

export type WebObservationScope = Readonly<{
  app: "web";
  feature: WebObservationFeature;
  userId: string | null;
  workspaceId: string | null;
  installationId: string | null;
  route: string | null;
  requestId: string | null;
  statusCode: number | null;
  code: string | null;
}>;

export type WebObservabilityUser = Readonly<{
  id: string;
}>;

export type WorkspaceTransitionBreadcrumbDetails = Readonly<{
  eventName:
    | "auth_reset_cleanup_deferred"
    | "session_bootstrap_redirected"
    | "workspace_activate_bootstrap_started"
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
  sessionVerificationState: string | null;
  isSessionVerified: boolean | null;
  cloudState: string | null;
  workspaceId: string | null;
  deletedWorkspaceId: string | null;
  replacementWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  activeWorkspaceId: string | null;
  availableWorkspaceIds: ReadonlyArray<string>;
  nextWorkspaceIds: ReadonlyArray<string>;
  redirected: boolean;
  errorMessage: string | null;
}>;

export type ChatControllerDebugBreadcrumbDetails = Readonly<{
  controllerId: string;
  eventName: string;
  workspaceId: string | null;
  currentSessionId: string | null;
  runId: string | null;
  requestVersion: number | null;
  trigger: string | null;
  replaceHistory: boolean | null;
  runState: string | null;
  messageCount: number | null;
  composerSuggestionCount: number | null;
  isRemoteReady: boolean | null;
  isHistoryLoaded: boolean | null;
}>;

export type AuthResetCleanupBreadcrumbDetails = Readonly<{
  eventName: "auth_reset_cleanup_deferred";
  errorMessage: string;
}>;

export type ProgressCacheMissBreadcrumbDetails = Readonly<{
  eventName: "progress_cache_miss";
  section: "summary" | "series" | "review_schedule";
  reason: "invalid_json" | "invalid_shape" | "scope_mismatch" | "time_zone_mismatch";
  workspaceIds: ReadonlyArray<string>;
}>;

export type WebBreadcrumbEvent =
  | Readonly<{
    action: "workspace_transition";
    scope: WebObservationScope;
    details: WorkspaceTransitionBreadcrumbDetails;
  }>
  | Readonly<{
    action: "chat_controller_debug";
    scope: WebObservationScope;
    details: ChatControllerDebugBreadcrumbDetails;
  }>
  | Readonly<{
    action: "auth_reset_cleanup_deferred";
    scope: WebObservationScope;
    details: AuthResetCleanupBreadcrumbDetails;
  }>
  | Readonly<{
    action: "progress_cache_miss";
    scope: WebObservationScope;
    details: ProgressCacheMissBreadcrumbDetails;
  }>;

export type ApiContractFailureDetails = Readonly<{
  endpoint: string;
  fieldPath: string;
  expected: string;
  sourceAction: string | null;
}>;

export type ChatLiveContractFailureDetails = Readonly<{
  eventType: string | null;
  sessionId: string;
  runId: string;
  resumeAttemptId: number | null;
}>;

export type WorkspaceActivationFailureDetails = Readonly<{
  operation:
    | "workspace_activate_bootstrap_failed"
    | "workspace_select_client_failed"
    | "workspace_create_client_failed"
    | "workspace_delete_client_failed";
  workspaceId: string | null;
}>;

export type SessionBootstrapFailureDetails = Readonly<{
  operation: "session_bootstrap_failed";
  verificationState: string | null;
}>;

export type SessionAccountSwitchFailureDetails = Readonly<{
  operation: "session_account_switch_failed";
  verificationState: string | null;
}>;

export type ChatSnapshotFailureDetails = Readonly<{
  sessionId: string;
  workspaceId: string | null;
  trigger: string;
  resumeAttemptId: number | null;
}>;

export type ChatRunRequestFailureDetails = Readonly<{
  operation:
    | "chat_remote_session_failed"
    | "chat_start_run_failed"
    | "chat_fresh_session_failed"
    | "chat_stop_run_failed";
  sessionId: string | null;
  workspaceId: string | null;
}>;

export type ChatLiveStreamFailureDetails = Readonly<{
  sessionId: string;
  runId: string;
  resumeAttemptId: number | null;
}>;

export type SyncFailureDetails = Readonly<{
  operation: "sync_workspace_refresh";
  workspaceId: string;
}>;

export type AuthResetCleanupFailureDetails = Readonly<{
  operation: "auth_reset_cleanup_failed";
}>;

export type WebAppOperation =
  | "account_deletion_submit"
  | "agent_connections_load"
  | "agent_connection_revoke"
  | "card_form_load"
  | "card_save"
  | "card_delete"
  | "cards_list_load"
  | "cards_page_load"
  | "cards_inline_save"
  | "review_data_load"
  | "review_submit"
  | "review_rollback_lookup"
  | "review_replenish"
  | "review_card_save"
  | "review_card_delete"
  | "review_schedule_preview"
  | "deck_list_load"
  | "deck_detail_load"
  | "deck_save"
  | "deck_delete"
  | "tags_load"
  | "workspace_overview_load"
  | "workspace_rename"
  | "workspace_delete_preview_load"
  | "workspace_delete_preview_retry"
  | "workspace_settings_load"
  | "workspace_reset_preview_load"
  | "workspace_reset_execute"
  | "workspace_export";

export type WebAppOperationFailureDetails = Readonly<{
  operation: WebAppOperation;
  entityId: string | null;
}>;

export type WebExceptionEvent =
  | Readonly<{
    action: "api_contract_failed";
    error: Error;
    scope: WebObservationScope;
    details: ApiContractFailureDetails;
  }>
  | Readonly<{
    action: "chat_live_contract_failed";
    error: Error;
    scope: WebObservationScope;
    details: ChatLiveContractFailureDetails;
  }>
  | Readonly<{
    action: "workspace_activation_failed";
    error: Error;
    scope: WebObservationScope;
    details: WorkspaceActivationFailureDetails;
  }>
  | Readonly<{
    action: "session_bootstrap_failed";
    error: Error;
    scope: WebObservationScope;
    details: SessionBootstrapFailureDetails;
  }>
  | Readonly<{
    action: "session_account_switch_failed";
    error: Error;
    scope: WebObservationScope;
    details: SessionAccountSwitchFailureDetails;
  }>
  | Readonly<{
    action: "chat_snapshot_failed";
    error: Error;
    scope: WebObservationScope;
    details: ChatSnapshotFailureDetails;
  }>
  | Readonly<{
    action: "chat_run_request_failed";
    error: Error;
    scope: WebObservationScope;
    details: ChatRunRequestFailureDetails;
  }>
  | Readonly<{
    action: "chat_live_stream_failed";
    error: Error;
    scope: WebObservationScope;
    details: ChatLiveStreamFailureDetails;
  }>
  | Readonly<{
    action: "sync_failed";
    error: Error;
    scope: WebObservationScope;
    details: SyncFailureDetails;
  }>
  | Readonly<{
    action: "auth_reset_cleanup_failed";
    error: Error;
    scope: WebObservationScope;
    details: AuthResetCleanupFailureDetails;
  }>
  | Readonly<{
    action: "app_operation_failed";
    error: Error;
    scope: WebObservationScope;
    details: WebAppOperationFailureDetails;
  }>;

export type ApiContractWarningDetails = Readonly<{
  endpoint: string;
  fieldPath: string;
  expected: string;
  observed: string | null;
}>;

export type WorkspaceStateWarningDetails = Readonly<{
  workspaceId: string | null;
  selectedWorkspaceId: string | null;
  activeWorkspaceId: string | null;
}>;

export type WebWarningEvent =
  | Readonly<{
    action: "api_contract_warning";
    scope: WebObservationScope;
    details: ApiContractWarningDetails;
  }>
  | Readonly<{
    action: "workspace_state_inconsistency";
    scope: WebObservationScope;
    details: WorkspaceStateWarningDetails;
  }>;

type SentryContextValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string>
  | ReadonlyArray<number>;

type SentryContext = Readonly<{
  readonly [key: string]: SentryContextValue;
}>;

type ErrorMetadata = Readonly<{
  name: string;
  endpoint: string | null;
  requestId: string | null;
  statusCode: number | null;
  code: string | null;
  bodyKind: string | null;
}>;

type ErrorMetadataValue = string | number | null;
type ErrorMetadataObject = Readonly<{
  readonly [key: string]: ErrorMetadataValue;
}>;

export function normalizeCaughtError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(`Caught non-Error value of type ${typeof error}`);
}

export function setWebObservabilityUser(user: WebObservabilityUser | null): void {
  if (isWebSentryEnabled === false) {
    return;
  }

  if (user === null || user.id.trim() === "") {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser({ id: user.id });
}

export function addWebBreadcrumb(event: WebBreadcrumbEvent): void {
  if (isWebSentryEnabled === false) {
    return;
  }

  Sentry.addBreadcrumb({
    category: `web.${event.action}`,
    level: "info",
    message: event.details.eventName,
    data: {
      ...scopeToContext(event.scope),
      ...detailsToContext(event.details),
    },
  });
}

export function captureWebWarning(event: WebWarningEvent): void {
  if (isWebSentryEnabled === false) {
    return;
  }

  Sentry.withScope((scope: Scope): void => {
    applyObservationScope(scope, event.scope, event.action);
    scope.setLevel("warning");
    scope.setContext("web.warning", detailsToContext(event.details));
    Sentry.captureMessage(`web.${event.action}`);
  });
}

export function captureWebException(event: WebExceptionEvent): void {
  if (isWebSentryEnabled === false) {
    return;
  }

  Sentry.withScope((scope: Scope): void => {
    applyObservationScope(scope, event.scope, event.action);
    scope.setFingerprint(buildExceptionFingerprint(event));
    scope.setContext("web.exception", detailsToContext(event.details));
    scope.setContext("web.error", errorMetadataToContext(readErrorMetadata(event.error)));
    Sentry.captureException(toSafeCapturedError(event.action, event.error));
  });
}

function buildExceptionFingerprint(event: WebExceptionEvent): Array<string> {
  if (event.action === "app_operation_failed") {
    return ["{{ default }}", event.action, event.details.operation];
  }

  return ["{{ default }}", event.action];
}

function isErrorMetadataObject(value: unknown): value is ErrorMetadataObject {
  return typeof value === "object"
    && value !== null
    && Array.isArray(value) === false;
}

function readStringMetadata(value: ErrorMetadataObject, key: string): string | null {
  const metadataValue = value[key];
  return typeof metadataValue === "string" && metadataValue.trim() !== "" ? metadataValue : null;
}

function readNumberMetadata(value: ErrorMetadataObject, key: string): number | null {
  const metadataValue = value[key];
  return typeof metadataValue === "number" && Number.isFinite(metadataValue) ? metadataValue : null;
}

function readErrorMetadata(error: Error): ErrorMetadata {
  if (isErrorMetadataObject(error) === false) {
    return {
      name: "Error",
      endpoint: null,
      requestId: null,
      statusCode: null,
      code: null,
      bodyKind: null,
    };
  }

  return {
    name: error.name.trim() === "" ? "Error" : error.name,
    endpoint: readStringMetadata(error, "endpoint"),
    requestId: readStringMetadata(error, "requestId"),
    statusCode: readNumberMetadata(error, "statusCode"),
    code: readStringMetadata(error, "code"),
    bodyKind: readStringMetadata(error, "responseBodyKind"),
  };
}

function errorMetadataToContext(metadata: ErrorMetadata): SentryContext {
  return {
    name: metadata.name,
    endpoint: metadata.endpoint,
    requestId: metadata.requestId,
    statusCode: metadata.statusCode,
    code: metadata.code,
    bodyKind: metadata.bodyKind,
  };
}

function toSafeErrorName(errorName: string): string {
  const safeName = errorName.replace(/[^A-Za-z0-9_.-]/gu, "");
  return safeName === "" ? "Error" : safeName;
}

function toSafeCapturedError(action: WebExceptionEvent["action"], error: Error): Error {
  const safeError = new Error(`web.${action}`);
  safeError.name = toSafeErrorName(error.name);
  if (typeof error.stack === "string" && error.stack.trim() !== "") {
    const [, ...stackFrames] = error.stack.split("\n");
    safeError.stack = stackFrames.length === 0
      ? `${safeError.name}: ${safeError.message}`
      : `${safeError.name}: ${safeError.message}\n${stackFrames.join("\n")}`;
  }

  return safeError;
}

function applyObservationScope(scope: Scope, observationScope: WebObservationScope, action: string): void {
  scope.setTag("app", observationScope.app);
  scope.setTag("feature", observationScope.feature);
  scope.setTag("web.action", action);
  if (observationScope.userId !== null) {
    scope.setUser({ id: observationScope.userId });
  }
  if (observationScope.workspaceId !== null) {
    scope.setTag("workspace_id", observationScope.workspaceId);
  }
  if (observationScope.requestId !== null) {
    scope.setTag("request_id", observationScope.requestId);
  }
  if (observationScope.statusCode !== null) {
    scope.setTag("status_code", String(observationScope.statusCode));
  }
  if (observationScope.code !== null) {
    scope.setTag("code", observationScope.code);
  }

  scope.setContext("web.scope", scopeToContext(observationScope));
}

function scopeToContext(scope: WebObservationScope): SentryContext {
  return {
    app: scope.app,
    feature: scope.feature,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    installationId: scope.installationId,
    route: scope.route,
    requestId: scope.requestId,
    statusCode: scope.statusCode,
    code: scope.code,
  };
}

function detailsToContext(details: WebBreadcrumbEvent["details"] | WebWarningEvent["details"] | WebExceptionEvent["details"]): SentryContext {
  return details as SentryContext;
}
