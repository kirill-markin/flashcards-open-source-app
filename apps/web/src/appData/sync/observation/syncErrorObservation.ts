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

type SyncFailureEpisode = Readonly<{
  userId: string;
  /** The reasons already emitted in the current failure episode. */
  reportedReasons: Set<AnalyticsSyncFailureReason>;
}>;

/**
 * `sync_failed` is bounded at one event per distinct reason per failure episode rather than one per
 * failed run. Sync runs on every resume, poll and local write, so an extended offline stretch would
 * otherwise fill a meaningful share of the 5000-event analytics queue with identical rows and let
 * drop-oldest evict the review events that carry the only quantitative fields in the catalog.
 *
 * The reasons already emitted are held as a set rather than as a single last-reason slot. The two
 * behave identically while one reason persists, which is the case the rule is written for, but a
 * flapping connection maps alternately onto `offline` and `timeout`, and a slot would emit on every
 * alternation — the per-run behaviour again, arriving by a different route. A set bounds the episode
 * at one event per distinct reason however the cause moves around inside it.
 *
 * That bound is a cross-client contract rather than a local choice: a client that emits more often
 * than one event per distinct key per episode makes the series incomparable with the others, and
 * `product_events` is append-only, so an over-count cannot be repaired afterwards. Each client's
 * gate holds its own key, and this one keys on the reason alone: the episode is already scoped per
 * workspace and per account, and nothing else enters the check below. The ambient `screen` the wire
 * stamps onto every event is outside that key, so these rows carry a column the gate never looked
 * at — a row shows the screen of the episode's first failure of that reason, and an episode whose
 * rows show several screens still costs one row per reason rather than one per reason and screen.
 *
 * The episode is kept per workspace because sync itself is per workspace: for an account with one
 * healthy and one persistently failing workspace, a single shared entry would have every healthy run
 * re-arm the gate and every failing run emit again — one `sync_failed` per sync cycle, exactly the
 * flood the gate exists to prevent. The account bounds the episode too, so the first failure seen by
 * a different account after an in-page switch starts a fresh one.
 */
const syncFailureEpisodeByWorkspace = new Map<string, SyncFailureEpisode>();

/**
 * Ends the failure episode for the workspace that synced cleanly, re-arming its next failure of
 * every reason. Deliberately scoped to that workspace: a healthy sync says nothing about another
 * workspace's ongoing failure, and clearing theirs too would let the next failing run emit again on
 * every cycle.
 */
export function observeSyncSuccess(workspaceId: string): void {
  syncFailureEpisodeByWorkspace.delete(workspaceId);
}

function startSyncFailureEpisode(workspaceId: string, userId: string): SyncFailureEpisode {
  const episode: SyncFailureEpisode = {
    userId,
    reportedReasons: new Set<AnalyticsSyncFailureReason>(),
  };
  syncFailureEpisodeByWorkspace.set(workspaceId, episode);
  return episode;
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
  const trackedEpisode = syncFailureEpisodeByWorkspace.get(input.workspaceId);
  const episode = trackedEpisode !== undefined && trackedEpisode.userId === input.userId
    ? trackedEpisode
    : startSyncFailureEpisode(input.workspaceId, input.userId);
  if (episode.reportedReasons.has(analyticsFailureReason) === false) {
    episode.reportedReasons.add(analyticsFailureReason);
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
