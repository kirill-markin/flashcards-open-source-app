import {
  toAnalyticsSyncFailureReason,
  track,
  type AnalyticsSyncFailureReason,
} from "../../../analytics";
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
import { isBrowserApiNetworkError } from "../../../observability/apiNetworkErrorPolicy";

const workspaceNotFoundErrorCode = "WORKSPACE_NOT_FOUND";
const workspaceSyncDiscardedErrorName = "WorkspaceSyncDiscardedError";
const syncFailureCapturedProperty = "__flashcardsSyncFailureCaptured";

type TrackedSyncFailure = Readonly<{
  userId: string;
  reason: AnalyticsSyncFailureReason;
}>;

/**
 * `sync_failed` is emitted on the transition into failure rather than once per failed run. Sync runs
 * on every resume, poll and local write, so an extended offline stretch would otherwise fill a
 * meaningful share of the 5000-event analytics queue with identical rows and let drop-oldest evict
 * the review events that carry the only quantitative fields in the catalog.
 *
 * The transition is kept per workspace because sync itself is per workspace: for an account with one
 * healthy and one persistently failing workspace, a single shared entry would have every healthy run
 * re-arm the gate and every failing run emit again — one `sync_failed` per sync cycle, exactly the
 * flood the gate exists to prevent. The account and the reason are part of the transition too, so a
 * failure that changes cause is emitted again, and so is the first failure seen by a different
 * account after an in-page switch. iOS and Android emit on the same transition, which is what keeps
 * the three clients comparable.
 */
const lastTrackedSyncFailureByWorkspace = new Map<string, TrackedSyncFailure>();

/**
 * Re-arms the transition for the workspace that synced cleanly. Deliberately scoped to that
 * workspace: a healthy sync says nothing about another workspace's ongoing failure, and clearing
 * theirs too would let the next failing run emit again on every cycle.
 */
export function observeSyncSuccess(workspaceId: string): void {
  lastTrackedSyncFailureByWorkspace.delete(workspaceId);
}

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

type SyncFailureObservationMetadata = Readonly<{
  syncFailureWasCaptured?: unknown;
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

  if (isBrowserApiNetworkError(error)) {
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

export function attachSyncFailureObservation(error: Error, wasCaptured: boolean): Error {
  Object.assign(error, {
    syncFailureWasCaptured: wasCaptured,
  });
  if (wasCaptured) {
    markSyncFailureCaptured(error);
  }
  return error;
}

export function getSyncFailureObservationCaptureState(error: unknown): boolean | null {
  if (error instanceof Error === false) {
    return null;
  }

  const wasCaptured = (error as SyncFailureObservationMetadata).syncFailureWasCaptured;
  if (typeof wasCaptured === "boolean") {
    return wasCaptured;
  }

  return isCapturedSyncFailure(error) ? true : null;
}

export function observeSyncFailure(input: SyncFailureObservationInput): boolean {
  // Reached only for genuine sync failures: auth redirects, discarded workspaces and stale workspace
  // lookups return before this call.
  const analyticsFailureReason = toAnalyticsSyncFailureReason(input.error);
  const lastTrackedFailure = lastTrackedSyncFailureByWorkspace.get(input.workspaceId);
  if (
    lastTrackedFailure === undefined
    || lastTrackedFailure.userId !== input.userId
    || lastTrackedFailure.reason !== analyticsFailureReason
  ) {
    lastTrackedSyncFailureByWorkspace.set(input.workspaceId, {
      userId: input.userId,
      reason: analyticsFailureReason,
    });
    track({ name: "sync_failed", reason: analyticsFailureReason });
  }

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
