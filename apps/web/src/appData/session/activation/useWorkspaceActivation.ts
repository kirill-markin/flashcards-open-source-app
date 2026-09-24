import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createWorkspace as createWorkspaceRequest,
  isAuthRedirectError,
  listWorkspaces,
  selectWorkspace,
} from "../../../api";
import {
  clearAllLocalBrowserData,
  type LocalBrowserDataCleanupReason,
} from "../../../accountDeletion";
import { reset as resetAnalytics } from "../../../analytics";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import { putCloudSettings } from "../../../localDb/sync/cloudSettings";
import type {
  SessionInfo,
  WorkspaceSummary,
} from "../../../types";
import {
  findWorkspaceById,
  getErrorMessage,
  markSelectedWorkspaces,
} from "../../domain";
import {
  buildLinkedCloudSettings,
} from "../cloud/workspaceSessionCloud";
import { resetWebGuestSession } from "../guest/webGuestSession";
import {
  activateEntryWorkspace,
  defaultWorkspaceName,
  retireEntryWorkspaceAddress,
} from "./workspaceActivationHelpers";
import {
  captureWorkspaceTransitionError,
  logWorkspaceTransition,
} from "../observation/workspaceSessionObservation";
import { getSyncFailureObservationCaptureState } from "../../sync/observation/syncErrorObservation";
import type {
  WorkspaceSessionActivation,
  WorkspaceSessionSetters,
  WorkspaceSessionState,
  WorkspaceSessionSyncActions,
  WorkspaceSessionUiActions,
} from "../workspaceSessionTypes";
import { normalizeCaughtError, type WorkspaceActivationBootstrapPhase } from "../../../observability/webObservability";

type UseWorkspaceActivationParams =
  & Readonly<{
    indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  }>
  & Pick<WorkspaceSessionState, "activeWorkspace" | "sessionVerificationState">
  & WorkspaceSessionSetters
  & WorkspaceSessionSyncActions
  & WorkspaceSessionUiActions;

/**
 * What persisting the account's first default may legitimately answer with, and therefore what is
 * reported as a transition rather than as a fault: the session stopped being usable between
 * `GET /workspaces` and this call, or the workspace it names stopped existing under it. Anything
 * else is a server or contract problem worth seeing even though this write is not fatal.
 *
 * Status-guarded like `isExpectedWorkspaceActionApiError` in `useWorkspaceActions.ts`, rather than
 * code-only like `isExpectedWorkspaceSessionApiError` in `useWorkspaceLifecycle.ts`: the codes say
 * what a client-expected rejection looks like, not what a broken server may answer with, so a 5xx
 * carrying one of them is a server fault that must still reach Sentry.
 */
function isExpectedFirstAccountDefaultPersistError(error: Error): boolean {
  if (error instanceof ApiError === false) {
    return false;
  }

  if (error.statusCode < 400 || error.statusCode >= 500) {
    return false;
  }

  switch (error.code) {
    case "AUTH_UNAUTHORIZED":
    case "SESSION_CSRF_TOKEN_INVALID":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return false;
}

/**
 * The workspace `sessionLoadState === "ready"` is ready for. Widened to the absence it refuses so
 * the invariant is checked here, where `ready` is produced, rather than re-traced across every
 * `setActiveWorkspace(null)` site whenever one of them changes: `useWorkspacePath` throws on a
 * workspace-scoped address built without an active workspace, and `AppShell` builds those addresses
 * on the strength of `ready` alone, so publishing that state over no workspace is a crash one render
 * later with nothing left to say which publisher caused it.
 */
function requireWorkspaceForReadySession(workspace: WorkspaceSummary | null): WorkspaceSummary {
  if (workspace === null) {
    throw new Error("Session published as ready with no active workspace");
  }

  return workspace;
}

export function useWorkspaceActivation(params: UseWorkspaceActivationParams): WorkspaceSessionActivation {
  const {
    setSessionLoadState,
    setSessionVerificationState,
    setSessionErrorMessage,
    setSessionTechnicalError,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setErrorMessage,
    setTechnicalError,
    setCloudSettings,
    refreshWorkspaceView,
    runSyncForWorkspace,
    discardAllSyncWork,
    resetUserScopedUiState,
    activeWorkspace,
    sessionVerificationState,
    indexedDbOpenRecoveryState,
  } = params;
  const workspaceBootstrapGenerationRef = useRef<number>(0);
  const deferredBootstrapWorkspaceRef = useRef<WorkspaceSummary | null>(null);
  const [deferredBootstrapVersion, setDeferredBootstrapVersion] = useState<number>(0);

  const clearConfirmedUserScopedState = useCallback(async function clearConfirmedUserScopedState(
    reason: LocalBrowserDataCleanupReason,
  ): Promise<void> {
    indexedDbOpenRecoveryState.throwIfFailed();

    // Starts a fresh analytics session and drops the queued events so a second person on this
    // browser cannot inherit the first person's unsent ones. The identity behind them is
    // deliberately kept: it is the shared visitor cookie, which belongs to the browser rather than
    // to whoever was signed in, and it survives this boundary like every other. Do not flush first:
    // this runs after the previous credential is gone or after `getSession()` already returned
    // somebody else's session, so a batch sent here would post the previous account's events on the
    // new account's credential. The drain happens on the other side of the navigation, in the
    // control that is about to destroy the credential (`SignOutLink`, and the account deletion in
    // `accountDeletion/AccountDeletionRecoveryGate.tsx`); what it did not deliver is discarded here
    // and the loss is counted and reported inside `reset()`.
    resetAnalytics();
    // Removed here, synchronously, rather than by the `flashcards-` prefix sweep inside
    // `clearAllLocalBrowserData` below: that sweep is several awaits away and does not run at all
    // when the IndexedDB recovery guard fires first, and until the key is gone the link started for
    // the outgoing person could still read the envelope back out of storage and bind that guest to
    // whoever signs in next (`webGuestSession.ts`).
    resetWebGuestSession();
    workspaceBootstrapGenerationRef.current += 1;
    deferredBootstrapWorkspaceRef.current = null;
    setSession(null);
    setActiveWorkspace(null);
    setAvailableWorkspaces([]);
    setCloudSettings(null);
    setSessionLoadState("loading");
    setSessionVerificationState("unverified");
    setSessionTechnicalError(null);
    setTechnicalError(null);
    resetUserScopedUiState();
    await discardAllSyncWork(async (): Promise<void> => {
      indexedDbOpenRecoveryState.throwIfFailed();
      await clearAllLocalBrowserData(reason, indexedDbOpenRecoveryState.throwIfFailed);
      indexedDbOpenRecoveryState.throwIfFailed();
    });
    indexedDbOpenRecoveryState.throwIfFailed();
  }, [
    discardAllSyncWork,
    indexedDbOpenRecoveryState,
    resetUserScopedUiState,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setCloudSettings,
    setSession,
    setSessionLoadState,
    setSessionTechnicalError,
    setSessionVerificationState,
    setTechnicalError,
  ]);

  const publishSelectedWorkspace = useCallback(function publishSelectedWorkspace(
    currentSession: SessionInfo,
    currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
    workspace: WorkspaceSummary,
  ): void {
    const readyWorkspace = requireWorkspaceForReadySession(workspace);
    const nextWorkspaces = markSelectedWorkspaces(currentWorkspaces, readyWorkspace.workspaceId);
    setAvailableWorkspaces(nextWorkspaces);
    setActiveWorkspace({
      ...readyWorkspace,
      isSelected: true,
    });
    setSession({
      ...currentSession,
      selectedWorkspaceId: readyWorkspace.workspaceId,
    });
    setSessionLoadState("ready");
  }, [
    setActiveWorkspace,
    setAvailableWorkspaces,
    setSession,
    setSessionLoadState,
  ]);

  const bootstrapWorkspaceInBackground = useCallback(function bootstrapWorkspaceInBackground(
    workspace: WorkspaceSummary,
  ): void {
    const bootstrapGeneration = workspaceBootstrapGenerationRef.current;
    const isCurrentBootstrapGeneration = function isCurrentBootstrapGeneration(): boolean {
      return bootstrapGeneration === workspaceBootstrapGenerationRef.current;
    };

    logWorkspaceTransition("workspace_activate_bootstrap_started", {
      workspaceId: workspace.workspaceId,
      sessionVerificationState,
      bootstrapPhase: "refresh_before_sync",
    });

    void (async (): Promise<void> => {
      let bootstrapPhase: WorkspaceActivationBootstrapPhase = "refresh_before_sync";
      try {
        await refreshWorkspaceView(workspace.workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (sessionVerificationState !== "verified") {
          if (isCurrentBootstrapGeneration() === false) {
            return;
          }

          bootstrapPhase = "deferred_until_verified";
          deferredBootstrapWorkspaceRef.current = workspace;
          setDeferredBootstrapVersion((currentVersion) => currentVersion + 1);
          logWorkspaceTransition("workspace_activate_bootstrap_deferred", {
            workspaceId: workspace.workspaceId,
            sessionVerificationState,
            bootstrapPhase,
          });
          return;
        }

        deferredBootstrapWorkspaceRef.current = null;
        bootstrapPhase = "run_sync";
        await runSyncForWorkspace(workspace);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        bootstrapPhase = "final_refresh";
        await refreshWorkspaceView(workspace.workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        bootstrapPhase = "completed";
        setSessionErrorMessage("");
        setErrorMessage("");
        setSessionTechnicalError(null);
        setTechnicalError(null);
        logWorkspaceTransition("workspace_activate_bootstrap_succeeded", {
          workspaceId: workspace.workspaceId,
          sessionVerificationState,
          bootstrapPhase,
        });
      } catch (error) {
        const normalizedError = normalizeCaughtError(error);
        indexedDbOpenRecoveryState.markFailed(normalizedError);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        if (isAuthRedirectError(error)) {
          logWorkspaceTransition("workspace_activate_bootstrap_redirected", {
            workspaceId: workspace.workspaceId,
            redirected: true,
            sessionVerificationState,
            bootstrapPhase,
          });
          setSessionLoadState("redirecting");
          return;
        }

        const nextErrorMessage = getErrorMessage(normalizedError);
        const syncFailureCaptureState = getSyncFailureObservationCaptureState(normalizedError);
        if (syncFailureCaptureState === null) {
          captureWorkspaceTransitionError("workspace_activate_bootstrap_failed", {
            workspaceId: workspace.workspaceId,
            errorMessage: nextErrorMessage,
            sessionVerificationState,
            bootstrapPhase,
          }, normalizedError);
        }
        setSessionErrorMessage(nextErrorMessage);
        setErrorMessage(nextErrorMessage);
        setSessionTechnicalError(syncFailureCaptureState === false ? null : normalizedError);
        setTechnicalError(syncFailureCaptureState === false ? null : normalizedError);
      }
    })();
  }, [
    indexedDbOpenRecoveryState,
    refreshWorkspaceView,
    runSyncForWorkspace,
    sessionVerificationState,
    setErrorMessage,
    setSessionErrorMessage,
    setSessionTechnicalError,
    setSessionLoadState,
    setTechnicalError,
  ]);

  useEffect(() => {
    if (indexedDbOpenRecoveryState.hasFailed() || sessionVerificationState !== "verified") {
      return;
    }

    const deferredWorkspace = deferredBootstrapWorkspaceRef.current;
    if (deferredWorkspace === null) {
      return;
    }

    if (activeWorkspace?.workspaceId !== deferredWorkspace.workspaceId) {
      deferredBootstrapWorkspaceRef.current = null;
      return;
    }

    deferredBootstrapWorkspaceRef.current = null;
    bootstrapWorkspaceInBackground(activeWorkspace);
  }, [
    activeWorkspace,
    bootstrapWorkspaceInBackground,
    deferredBootstrapVersion,
    indexedDbOpenRecoveryState,
    sessionVerificationState,
  ]);

  const activateWorkspace = useCallback(async function activateWorkspace(
    currentSession: SessionInfo,
    currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
    workspace: WorkspaceSummary,
  ): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    logWorkspaceTransition("workspace_activate_started", {
      workspaceId: workspace.workspaceId,
      selectedWorkspaceId: currentSession.selectedWorkspaceId,
      availableWorkspaceIds: currentWorkspaces.map((currentWorkspace) => currentWorkspace.workspaceId),
    });
    const linkedCloudSettings = buildLinkedCloudSettings(currentSession, workspace.workspaceId);
    try {
      await putCloudSettings(linkedCloudSettings);
    } catch (error) {
      indexedDbOpenRecoveryState.markFailed(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      throw error;
    }
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    logWorkspaceTransition("workspace_activate_cloud_settings_saved", {
      workspaceId: workspace.workspaceId,
      selectedWorkspaceId: workspace.workspaceId,
    });
    setCloudSettings(linkedCloudSettings);
    setSessionErrorMessage("");
    setErrorMessage("");
    setSessionTechnicalError(null);
    setTechnicalError(null);
    publishSelectedWorkspace(currentSession, currentWorkspaces, workspace);
    logWorkspaceTransition("workspace_activate_published", {
      workspaceId: workspace.workspaceId,
      selectedWorkspaceId: workspace.workspaceId,
      availableWorkspaceIds: currentWorkspaces.map((currentWorkspace) => currentWorkspace.workspaceId),
    });
    bootstrapWorkspaceInBackground(workspace);
  }, [
    bootstrapWorkspaceInBackground,
    indexedDbOpenRecoveryState,
    publishSelectedWorkspace,
    setCloudSettings,
    setErrorMessage,
    setSessionErrorMessage,
    setSessionTechnicalError,
    setTechnicalError,
  ]);

  const resolveInitialWorkspace = useCallback(async function resolveInitialWorkspace(
    currentSession: SessionInfo,
  ): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const workspaces = await listWorkspaces();
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    // The address the browser arrived on decides the workspace, ahead of the account's server-side
    // selection and without moving it. The bootstrap is the usual one, so the workspace a card link
    // names syncs before that card is looked up. Asked first, so an address naming a workspace this
    // account cannot open is recorded as unavailable — for the gate in `App.tsx` — even on the
    // account that has no workspace yet and gets one created below. What a second run, a rejected
    // activation, an overlapping `StrictMode` pair and an account switch each do is decided by the
    // entry-address model in `workspaceActivationHelpers.ts`, not here.
    const didActivateEntryWorkspace = await activateEntryWorkspace(
      currentSession.userId,
      workspaces,
      (entryWorkspace) => activateWorkspace(currentSession, workspaces, entryWorkspace),
    );
    if (didActivateEntryWorkspace) {
      // Following a link must not move an account default, but it must not leave the account without
      // one either. An account whose single workspace was never selected keeps answering
      // `GET /session` with `selectedWorkspaceId: null` to iOS, Android and the agent surfaces until
      // something persists a first default, and the branch below — the one that used to persist it —
      // is no longer reached on this address. Only when there is no server-side selection at all, so
      // an existing default is never moved, and only for the single workspace that branch would have
      // persisted anyway, which on this path is the workspace the address named.
      if (currentSession.selectedWorkspaceId === null && workspaces.length === 1) {
        const firstAccountDefault = workspaces[0];
        try {
          await selectWorkspace(firstAccountDefault.workspaceId);
          // The address and the account's stored default now name the same workspace, so the
          // address has nothing left to decide and a later `resolveInitialWorkspace` reaches that
          // workspace through the ordinary default path. Retiring it is also what stops
          // `overridesAccountDefault` — read off the server's mark before this write — from
          // outliving the divergence it recorded and making `storeWarmStartSnapshot` refuse every
          // write for the life of a document whose address and default agree.
          retireEntryWorkspaceAddress();
        } catch (error) {
          if (isAuthRedirectError(error)) {
            throw error;
          }

          // Bookkeeping for the other clients, written after this workspace was already published
          // and its bootstrap started. Failing it leaves the account exactly where it already was
          // (`selectedWorkspaceId: null`), which the next boot retries, so it must not reject the
          // bootstrap: that would replace the link's workspace with the error gate, leave the
          // session unverified, and loop on a retry that re-runs this same call. The address stays
          // whatever it was, so the snapshot guard keeps holding while the divergence does.
          const normalizedError = normalizeCaughtError(error);
          const persistErrorMessage = getErrorMessage(normalizedError);
          logWorkspaceTransition("workspace_entry_default_persist_failed", {
            workspaceId: firstAccountDefault.workspaceId,
            selectedWorkspaceId: currentSession.selectedWorkspaceId,
            errorMessage: persistErrorMessage,
          });
          if (isExpectedFirstAccountDefaultPersistError(normalizedError) === false) {
            captureWorkspaceTransitionError("workspace_entry_default_persist_failed", {
              workspaceId: firstAccountDefault.workspaceId,
              errorMessage: persistErrorMessage,
            }, normalizedError);
          }
        }
      }

      return;
    }

    if (workspaces.length === 0) {
      const createdWorkspace = await createWorkspaceRequest(defaultWorkspaceName);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      await activateWorkspace(currentSession, [createdWorkspace], createdWorkspace);
      return;
    }

    const selectedWorkspace = findWorkspaceById(workspaces, currentSession.selectedWorkspaceId);
    if (selectedWorkspace !== null) {
      await activateWorkspace(currentSession, workspaces, selectedWorkspace);
      return;
    }

    if (workspaces.length === 1) {
      const onlyWorkspace = workspaces[0];
      const selectedOnlyWorkspace = await selectWorkspace(onlyWorkspace.workspaceId);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      await activateWorkspace(currentSession, [selectedOnlyWorkspace], selectedOnlyWorkspace);
      return;
    }

    setAvailableWorkspaces(workspaces);
    setActiveWorkspace(null);
    setSession(currentSession);
    setSessionLoadState("selecting_workspace");
  }, [activateWorkspace, indexedDbOpenRecoveryState, setActiveWorkspace, setAvailableWorkspaces, setSession, setSessionLoadState]);

  return {
    activateWorkspace,
    resolveInitialWorkspace,
    clearConfirmedUserScopedState,
  };
}
