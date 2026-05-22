import { useCallback } from "react";
import {
  createWorkspace as createWorkspaceRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  isAuthRedirectError,
  loadWorkspaceResetProgressPreview as loadWorkspaceResetProgressPreviewRequest,
  renameWorkspace as renameWorkspaceRequest,
  resetWorkspaceProgress as resetWorkspaceProgressRequest,
  selectWorkspace,
} from "../../api";
import type { TranslationKey } from "../../i18n";
import { captureApiContractError } from "../../observability/apiContractObservation";
import type {
  ResetWorkspaceProgressResponse,
  SessionInfo,
  WorkspaceResetProgressPreview,
  WorkspaceSummary,
} from "../../types";
import { getErrorMessage } from "../domain";
import type { SessionVerificationState } from "./warmStart";
import {
  createRemoteActionLockedError,
  replaceWorkspaceSummary,
} from "./workspaceSessionHelpers";
import {
  buildWorkspaceInteractionLogDetails,
  captureWorkspaceTransitionError,
  logWorkspaceTransition,
} from "./workspaceSessionObservation";
import type {
  WorkspaceSessionCommands,
  WorkspaceSessionSetters,
  WorkspaceSessionState,
} from "./workspaceSessionTypes";

type UseWorkspaceActionsParams =
  & Readonly<{
    t: (key: TranslationKey) => string;
    activateWorkspace: (
      currentSession: SessionInfo,
      currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
      workspace: WorkspaceSummary,
    ) => Promise<void>;
    runSync: () => Promise<void>;
    discardWorkspaceSync: (workspaceId: string) => void;
  }>
  & WorkspaceSessionState
  & WorkspaceSessionSetters;

function requireVerifiedWorkspaceSession(
  session: SessionInfo | null,
  sessionVerificationState: SessionVerificationState,
  t: (key: TranslationKey) => string,
): SessionInfo {
  if (session === null) {
    throw new Error(t("app.sessionUnavailable"));
  }

  if (sessionVerificationState !== "verified") {
    throw createRemoteActionLockedError(t);
  }

  return session;
}

export function useWorkspaceActions(params: UseWorkspaceActionsParams): WorkspaceSessionCommands {
  const {
    t,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    activateWorkspace,
    runSync,
    discardWorkspaceSync,
  } = params;

  const chooseWorkspace = useCallback(async function chooseWorkspace(workspaceId: string): Promise<void> {
    const verifiedSession = requireVerifiedWorkspaceSession(session, sessionVerificationState, t);

    setIsChoosingWorkspace(true);
    try {
      logWorkspaceTransition("workspace_select_client_started", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        verifiedSession,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        workspaceId,
        null,
      ));
      const selectedWorkspace = await selectWorkspace(workspaceId);
      logWorkspaceTransition("workspace_select_client_succeeded", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        verifiedSession,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        selectedWorkspace.workspaceId,
        null,
      ));
      await activateWorkspace(verifiedSession, availableWorkspaces, selectedWorkspace);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      captureWorkspaceTransitionError("workspace_select_client_failed", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        verifiedSession,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        workspaceId,
        getErrorMessage(error),
      ), error);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [
    activateWorkspace,
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    session,
    sessionVerificationState,
    t,
    setErrorMessage,
    setIsChoosingWorkspace,
  ]);

  const createWorkspace = useCallback(async function createWorkspace(name: string): Promise<void> {
    const verifiedSession = requireVerifiedWorkspaceSession(session, sessionVerificationState, t);

    const trimmedName = name.trim();
    if (trimmedName === "") {
      throw new Error(t("settingsCurrentWorkspace.workspaceNameRequired"));
    }

    setIsChoosingWorkspace(true);
    try {
      logWorkspaceTransition("workspace_create_client_started", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        verifiedSession,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        null,
        null,
      ));
      const createdWorkspace = await createWorkspaceRequest(trimmedName);
      logWorkspaceTransition("workspace_create_client_succeeded", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        verifiedSession,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        createdWorkspace.workspaceId,
        null,
      ));
      const nextWorkspaces = replaceWorkspaceSummary(availableWorkspaces, createdWorkspace);
      await activateWorkspace(verifiedSession, nextWorkspaces, createdWorkspace);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      captureWorkspaceTransitionError("workspace_create_client_failed", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        verifiedSession,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        null,
        nextErrorMessage,
      ), error);
      setErrorMessage(nextErrorMessage);
      throw error;
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [
    activateWorkspace,
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    session,
    sessionVerificationState,
    t,
    setErrorMessage,
    setIsChoosingWorkspace,
  ]);

  const renameWorkspace = useCallback(async function renameWorkspace(
    workspaceId: string,
    name: string,
  ): Promise<void> {
    const verifiedSession = requireVerifiedWorkspaceSession(session, sessionVerificationState, t);

    const trimmedName = name.trim();
    if (trimmedName === "") {
      throw new Error(t("settingsCurrentWorkspace.workspaceNameRequired"));
    }

    setIsChoosingWorkspace(true);
    try {
      const renamedWorkspace = await renameWorkspaceRequest(workspaceId, trimmedName);
      const nextWorkspaces = replaceWorkspaceSummary(availableWorkspaces, renamedWorkspace);
      setAvailableWorkspaces(nextWorkspaces);
      if (activeWorkspace?.workspaceId === workspaceId) {
        setActiveWorkspace({
          ...renamedWorkspace,
          isSelected: true,
        });
      }
      setErrorMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      captureApiContractError(error, {
        feature: "settings",
        sourceAction: "workspace_rename_client",
        userId: verifiedSession.userId,
        workspaceId,
        installationId: cloudSettings?.installationId ?? null,
      });
      setErrorMessage(nextErrorMessage);
      throw error;
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [
    activeWorkspace,
    availableWorkspaces,
    cloudSettings?.installationId,
    session,
    sessionVerificationState,
    t,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setErrorMessage,
    setIsChoosingWorkspace,
  ]);

  const deleteWorkspace = useCallback(async function deleteWorkspace(
    workspaceId: string,
    confirmationText: string,
  ): Promise<void> {
    const verifiedSession = requireVerifiedWorkspaceSession(session, sessionVerificationState, t);

    setIsChoosingWorkspace(true);
    try {
      logWorkspaceTransition("workspace_delete_client_started", {
        workspaceId,
        selectedWorkspaceId: verifiedSession.selectedWorkspaceId,
        availableWorkspaceIds: availableWorkspaces.map((workspace) => workspace.workspaceId),
      });
      const response = await deleteWorkspaceRequest(workspaceId, confirmationText);
      logWorkspaceTransition("workspace_delete_client_succeeded", {
        workspaceId,
        deletedWorkspaceId: response.deletedWorkspaceId,
        replacementWorkspaceId: response.workspace.workspaceId,
      });
      discardWorkspaceSync(response.deletedWorkspaceId);
      const nextWorkspaces = replaceWorkspaceSummary(
        availableWorkspaces.filter((workspace) => workspace.workspaceId !== response.deletedWorkspaceId),
        response.workspace,
      );
      logWorkspaceTransition("workspace_delete_client_preparing_activation", {
        deletedWorkspaceId: response.deletedWorkspaceId,
        replacementWorkspaceId: response.workspace.workspaceId,
        nextWorkspaceIds: nextWorkspaces.map((workspace) => workspace.workspaceId),
      });
      await activateWorkspace(verifiedSession, nextWorkspaces, response.workspace);
      setErrorMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        logWorkspaceTransition("workspace_delete_client_redirected", {
          workspaceId,
          redirected: true,
        });
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      captureWorkspaceTransitionError("workspace_delete_client_failed", {
        workspaceId,
        errorMessage: nextErrorMessage,
      }, error);
      setErrorMessage(nextErrorMessage);
      throw error;
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [
    activateWorkspace,
    availableWorkspaces,
    discardWorkspaceSync,
    session,
    sessionVerificationState,
    t,
    setErrorMessage,
    setIsChoosingWorkspace,
  ]);

  const loadWorkspaceResetProgressPreview = useCallback(async function loadWorkspaceResetProgressPreview(
    workspaceId: string,
  ): Promise<WorkspaceResetProgressPreview> {
    requireVerifiedWorkspaceSession(session, sessionVerificationState, t);

    if (cloudSettings?.cloudState !== "linked") {
      throw new Error(t("settingsWorkspace.resetProgress.availabilityHint"));
    }

    try {
      if (activeWorkspace?.workspaceId === workspaceId) {
        await runSync();
      }
      const preview = await loadWorkspaceResetProgressPreviewRequest(workspaceId);
      setErrorMessage("");
      return preview;
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return Promise.reject(error);
      }

      const nextErrorMessage = getErrorMessage(error);
      setErrorMessage(nextErrorMessage);
      throw error;
    }
  }, [activeWorkspace?.workspaceId, cloudSettings?.cloudState, runSync, session, sessionVerificationState, t, setErrorMessage]);

  const resetWorkspaceProgress = useCallback(async function resetWorkspaceProgress(
    workspaceId: string,
    confirmationText: string,
  ): Promise<ResetWorkspaceProgressResponse> {
    requireVerifiedWorkspaceSession(session, sessionVerificationState, t);

    if (cloudSettings?.cloudState !== "linked") {
      throw new Error(t("settingsWorkspace.resetProgress.availabilityHint"));
    }

    try {
      const response = await resetWorkspaceProgressRequest(workspaceId, confirmationText);
      if (activeWorkspace?.workspaceId === workspaceId) {
        void runSync();
      }
      setErrorMessage("");
      return response;
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return Promise.reject(error);
      }

      const nextErrorMessage = getErrorMessage(error);
      setErrorMessage(nextErrorMessage);
      throw error;
    }
  }, [activeWorkspace?.workspaceId, cloudSettings?.cloudState, runSync, session, sessionVerificationState, t, setErrorMessage]);

  return {
    chooseWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    loadWorkspaceResetProgressPreview,
    resetWorkspaceProgress,
  };
}
