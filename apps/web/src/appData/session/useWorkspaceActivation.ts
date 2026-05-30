import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWorkspace as createWorkspaceRequest,
  isAuthRedirectError,
  listWorkspaces,
  selectWorkspace,
} from "../../api";
import { clearAllLocalBrowserData } from "../../accountDeletion";
import { putCloudSettings } from "../../localDb/cloudSettings";
import type {
  SessionInfo,
  WorkspaceSummary,
} from "../../types";
import {
  findWorkspaceById,
  getErrorMessage,
  markSelectedWorkspaces,
} from "../domain";
import {
  buildLinkedCloudSettings,
} from "./workspaceSessionCloud";
import {
  defaultWorkspaceName,
} from "./workspaceSessionHelpers";
import {
  captureWorkspaceTransitionError,
  logWorkspaceTransition,
} from "./workspaceSessionObservation";
import type {
  WorkspaceSessionActivation,
  WorkspaceSessionSetters,
  WorkspaceSessionState,
  WorkspaceSessionSyncActions,
  WorkspaceSessionUiActions,
} from "./workspaceSessionTypes";

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
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setErrorMessage,
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

  const clearConfirmedUserScopedState = useCallback(async function clearConfirmedUserScopedState(): Promise<void> {
    workspaceBootstrapGenerationRef.current += 1;
    deferredBootstrapWorkspaceRef.current = null;
    setSession(null);
    setActiveWorkspace(null);
    setAvailableWorkspaces([]);
    setCloudSettings(null);
    setSessionLoadState("loading");
    setSessionVerificationState("unverified");
    resetUserScopedUiState();
    await discardAllSyncWork(clearAllLocalBrowserData);
  }, [
    discardAllSyncWork,
    resetUserScopedUiState,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setCloudSettings,
    setSession,
    setSessionLoadState,
    setSessionVerificationState,
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
    });

    void (async (): Promise<void> => {
      try {
        await refreshWorkspaceView(workspace.workspaceId);
        if (sessionVerificationState !== "verified") {
          if (isCurrentBootstrapGeneration() === false) {
            return;
          }

          deferredBootstrapWorkspaceRef.current = workspace;
          setDeferredBootstrapVersion((currentVersion) => currentVersion + 1);
          logWorkspaceTransition("workspace_activate_bootstrap_deferred", {
            workspaceId: workspace.workspaceId,
            sessionVerificationState,
          });
          return;
        }

        deferredBootstrapWorkspaceRef.current = null;
        await runSyncForWorkspace(workspace);
        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        setSessionErrorMessage("");
        setErrorMessage("");
        logWorkspaceTransition("workspace_activate_bootstrap_succeeded", {
          workspaceId: workspace.workspaceId,
          sessionVerificationState,
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
          });
          setSessionLoadState("redirecting");
          return;
        }

        const nextErrorMessage = getErrorMessage(error);
        captureWorkspaceTransitionError("workspace_activate_bootstrap_failed", {
          workspaceId: workspace.workspaceId,
          errorMessage: nextErrorMessage,
          sessionVerificationState,
        }, error);
        setSessionErrorMessage(nextErrorMessage);
        setErrorMessage(nextErrorMessage);
      }
    })();
  }, [
    refreshWorkspaceView,
    runSyncForWorkspace,
    sessionVerificationState,
    setErrorMessage,
    setSessionErrorMessage,
    setSessionLoadState,
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
