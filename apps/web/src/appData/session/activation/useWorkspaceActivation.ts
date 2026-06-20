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
  } = params;
  const workspaceBootstrapGenerationRef = useRef<number>(0);
  const deferredBootstrapWorkspaceRef = useRef<WorkspaceSummary | null>(null);
  const [deferredBootstrapVersion, setDeferredBootstrapVersion] = useState<number>(0);

  const clearConfirmedUserScopedState = useCallback(async function clearConfirmedUserScopedState(
    reason: LocalBrowserDataCleanupReason,
  ): Promise<void> {
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
      await clearAllLocalBrowserData(reason);
    });
  }, [
    discardAllSyncWork,
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
        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        bootstrapPhase = "final_refresh";
        await refreshWorkspaceView(workspace.workspaceId);
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

        const normalizedError = normalizeCaughtError(error);
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
    if (sessionVerificationState !== "verified") {
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
    sessionVerificationState,
  ]);

  const activateWorkspace = useCallback(async function activateWorkspace(
    currentSession: SessionInfo,
    currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
    workspace: WorkspaceSummary,
  ): Promise<void> {
    logWorkspaceTransition("workspace_activate_started", {
      workspaceId: workspace.workspaceId,
      selectedWorkspaceId: currentSession.selectedWorkspaceId,
      availableWorkspaceIds: currentWorkspaces.map((currentWorkspace) => currentWorkspace.workspaceId),
    });
    const linkedCloudSettings = buildLinkedCloudSettings(currentSession, workspace.workspaceId);
    await putCloudSettings(linkedCloudSettings);
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
    const workspaces = await listWorkspaces();

    if (workspaces.length === 0) {
      const createdWorkspace = await createWorkspaceRequest(defaultWorkspaceName);
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
      await activateWorkspace(currentSession, [selectedOnlyWorkspace], selectedOnlyWorkspace);
      return;
    }

    setAvailableWorkspaces(workspaces);
    setActiveWorkspace(null);
    setSession(currentSession);
    setSessionLoadState("selecting_workspace");
  }, [activateWorkspace, setActiveWorkspace, setAvailableWorkspaces, setSession, setSessionLoadState]);

  return {
    activateWorkspace,
    resolveInitialWorkspace,
    clearConfirmedUserScopedState,
  };
}
