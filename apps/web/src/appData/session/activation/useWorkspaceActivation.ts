import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWorkspace as createWorkspaceRequest,
  isAuthRedirectError,
  listWorkspaces,
  selectWorkspace,
} from "../../../api";
import {
  clearAllLocalBrowserData,
  type LocalBrowserDataCleanupReason,
} from "../../../accountDeletion";
import {
  isIndexedDbOpenRecoveryFailureMark,
  ownsIndexedDbOpenRecoveryFailure,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
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
import {
  defaultWorkspaceName,
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
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      await clearAllLocalBrowserData(reason);
    });
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
    const nextWorkspaces = markSelectedWorkspaces(currentWorkspaces, workspace.workspaceId);
    setAvailableWorkspaces(nextWorkspaces);
    setActiveWorkspace({
      ...workspace,
      isSelected: true,
    });
    setSession({
      ...currentSession,
      selectedWorkspaceId: workspace.workspaceId,
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
        const markResult = indexedDbOpenRecoveryState.markFailed(normalizedError);
        if (isIndexedDbOpenRecoveryFailureMark(markResult) === false) {
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
        if (indexedDbOpenRecoveryState.hasFailed() && ownsIndexedDbOpenRecoveryFailure(markResult) === false) {
          return;
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
