import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createWorkspace as createWorkspaceRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  getSession,
  isAuthRedirectError,
  listWorkspaces,
  loadWorkspaceResetProgressPreview as loadWorkspaceResetProgressPreviewRequest,
  renameWorkspace as renameWorkspaceRequest,
  revalidateSession as revalidateSessionRequest,
  selectWorkspace,
  resetWorkspaceProgress as resetWorkspaceProgressRequest,
} from "../api";
import { clearAllLocalBrowserData, consumeAccountDeletedMarker } from "../accountDeletion";
import { getStableInstallationId } from "../clientIdentity";
import { loadCloudSettings, putCloudSettings } from "../localDb/cloudSettings";
import type {
  CloudSettings,
  ResetWorkspaceProgressResponse,
  SessionInfo,
  WorkspaceResetProgressPreview,
  WorkspaceSummary,
} from "../types";
import {
  findWorkspaceById,
  getErrorMessage,
  markSelectedWorkspaces,
} from "./domain";
import type { TranslationKey } from "../i18n";
import type { SessionLoadState } from "./types";
import type { SessionVerificationState } from "./warmStart";

const defaultWorkspaceName = "Personal";
const resumeRetryDelayMs = 750;
const resumeRetryCount = 2;

type UseWorkspaceSessionParams = Readonly<{
  t: (key: TranslationKey) => string;
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  setSessionLoadState: Dispatch<SetStateAction<SessionLoadState>>;
  setSessionVerificationState: Dispatch<SetStateAction<SessionVerificationState>>;
  setSessionErrorMessage: Dispatch<SetStateAction<string>>;
  setSession: Dispatch<SetStateAction<SessionInfo | null>>;
  setActiveWorkspace: Dispatch<SetStateAction<WorkspaceSummary | null>>;
  setAvailableWorkspaces: Dispatch<SetStateAction<ReadonlyArray<WorkspaceSummary>>>;
  setIsChoosingWorkspace: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setCloudSettings: Dispatch<SetStateAction<CloudSettings | null>>;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
  runSync: () => Promise<void>;
  runSyncSilently: () => Promise<void>;
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
}>;

type WorkspaceSession = Readonly<{
  initialize: () => Promise<void>;
  chooseWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string, confirmationText: string) => Promise<void>;
  loadWorkspaceResetProgressPreview: (workspaceId: string) => Promise<WorkspaceResetProgressPreview>;
  resetWorkspaceProgress: (workspaceId: string, confirmationText: string) => Promise<ResetWorkspaceProgressResponse>;
}>;

type WorkspaceTransitionLogDetails = Readonly<{
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
}>;

function buildLinkingReadyCloudSettings(session: SessionInfo): CloudSettings {
  return {
    installationId: getStableInstallationId(),
    cloudState: "linking-ready",
    linkedUserId: session.userId,
    linkedWorkspaceId: null,
    linkedEmail: session.profile.email,
    onboardingCompleted: session.selectedWorkspaceId !== null,
    updatedAt: new Date().toISOString(),
  };
}

function buildLinkedCloudSettings(session: SessionInfo, workspaceId: string): CloudSettings {
  return {
    installationId: getStableInstallationId(),
    cloudState: "linked",
    linkedUserId: session.userId,
    linkedWorkspaceId: workspaceId,
    linkedEmail: session.profile.email,
    onboardingCompleted: true,
    updatedAt: new Date().toISOString(),
  };
}

function replaceWorkspaceSummary(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  workspace: WorkspaceSummary,
): ReadonlyArray<WorkspaceSummary> {
  let didReplace = false;
  const nextWorkspaces = workspaces.map((currentWorkspace) => {
    if (currentWorkspace.workspaceId !== workspace.workspaceId) {
      return currentWorkspace;
    }

    didReplace = true;
    return workspace;
  });

  return didReplace ? nextWorkspaces : [...workspaces, workspace];
}

function consumeLoggedOutMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("logged_out") !== "1") {
    return false;
  }

  url.searchParams.delete("logged_out");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
  return true;
}

function createRemoteActionLockedError(t: (key: TranslationKey) => string): Error {
  return new Error(t("app.sessionRestoringActionLocked"));
}

function logWorkspaceTransition(event: string, details: WorkspaceTransitionLogDetails): void {
  console.info(event, details);
}

function logWorkspaceTransitionError(event: string, details: WorkspaceTransitionLogDetails): void {
  console.error(event, details);
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function buildWorkspaceInteractionLogDetails(
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

export function useWorkspaceSession(params: UseWorkspaceSessionParams): WorkspaceSession {
  const {
    t,
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    setSessionLoadState,
    setSessionVerificationState,
    setSessionErrorMessage,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    setCloudSettings,
    refreshWorkspaceView,
    runSync,
    runSyncSilently,
    runSyncForWorkspace,
  } = params;
  const resumePromiseRef = useRef<Promise<void> | null>(null);

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
    logWorkspaceTransition("workspace_activate_bootstrap_started", {
      workspaceId: workspace.workspaceId,
    });

    void (async (): Promise<void> => {
      try {
        await refreshWorkspaceView(workspace.workspaceId);
        await runSyncForWorkspace(workspace);
        setSessionErrorMessage("");
        setErrorMessage("");
        logWorkspaceTransition("workspace_activate_bootstrap_succeeded", {
          workspaceId: workspace.workspaceId,
        });
      } catch (error) {
        if (isAuthRedirectError(error)) {
          logWorkspaceTransition("workspace_activate_bootstrap_redirected", {
            workspaceId: workspace.workspaceId,
            redirected: true,
          });
          setSessionLoadState("redirecting");
          return;
        }

        const nextErrorMessage = getErrorMessage(error);
        logWorkspaceTransitionError("workspace_activate_bootstrap_failed", {
          workspaceId: workspace.workspaceId,
          errorMessage: nextErrorMessage,
        });
        setSessionErrorMessage(nextErrorMessage);
        setErrorMessage(nextErrorMessage);
      }
    })();
  }, [
    refreshWorkspaceView,
    runSyncForWorkspace,
    setErrorMessage,
    setSessionErrorMessage,
    setSessionLoadState,
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

  const initialize = useCallback(async function initialize(): Promise<void> {
    const shouldPreserveWarmStartState = sessionLoadState === "ready"
      && sessionVerificationState === "unverified"
      && session !== null
      && activeWorkspace !== null
      && availableWorkspaces.length > 0;

    // Warm start intentionally keeps the last known shell visible while the
    // browser revalidates auth in the background. If verification fails, this
    // optimistic state is discarded by the mismatch or redirect handling below.
    if (shouldPreserveWarmStartState === false) {
      setSessionLoadState("loading");
      setActiveWorkspace(null);
      setAvailableWorkspaces([]);
    }

    setSessionVerificationState("unverified");
    setSessionErrorMessage("");
    setErrorMessage("");

    try {
      if (consumeLoggedOutMarker()) {
        await clearAllLocalBrowserData();
      }

      if (consumeAccountDeletedMarker()) {
        await clearAllLocalBrowserData();
        setSession(null);
        setSessionLoadState("deleted");
        setSessionVerificationState("verified");
        setSessionErrorMessage(t("app.accountDeleted"));
        return;
      }

      const [currentSession, persistedCloudSettings] = await Promise.all([
        getSession(),
        loadCloudSettings(),
      ]);
      if (
        persistedCloudSettings !== null
        && persistedCloudSettings.linkedUserId !== null
        && persistedCloudSettings.linkedUserId !== currentSession.userId
      ) {
        setSession(null);
        setActiveWorkspace(null);
        setAvailableWorkspaces([]);
        setSessionLoadState("loading");
        await clearAllLocalBrowserData();
      }

      const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession);
      await putCloudSettings(linkingReadyCloudSettings);
      setCloudSettings(linkingReadyCloudSettings);
      await resolveInitialWorkspace(currentSession);
      setSessionVerificationState("verified");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        setSessionLoadState("redirecting");
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      setSessionLoadState("error");
      setSessionErrorMessage(nextErrorMessage);
    }
  }, [
    resolveInitialWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    t,
    activeWorkspace,
    availableWorkspaces,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setCloudSettings,
    setErrorMessage,
    setSession,
    setSessionErrorMessage,
    setSessionLoadState,
    setSessionVerificationState,
  ]);

  const chooseWorkspace = useCallback(async function chooseWorkspace(workspaceId: string): Promise<void> {
    if (session === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionVerificationState !== "verified") {
      throw createRemoteActionLockedError(t);
    }

    setIsChoosingWorkspace(true);
    try {
      logWorkspaceTransition("workspace_select_client_started", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        session,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        workspaceId,
        null,
      ));
      const selectedWorkspace = await selectWorkspace(workspaceId);
      logWorkspaceTransition("workspace_select_client_succeeded", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        session,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        selectedWorkspace.workspaceId,
        null,
      ));
      await activateWorkspace(session, availableWorkspaces, selectedWorkspace);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      logWorkspaceTransitionError("workspace_select_client_failed", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        session,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        workspaceId,
        getErrorMessage(error),
      ));
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
    if (session === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionVerificationState !== "verified") {
      throw createRemoteActionLockedError(t);
    }

    const trimmedName = name.trim();
    if (trimmedName === "") {
      throw new Error(t("settingsCurrentWorkspace.workspaceNameRequired"));
    }

    setIsChoosingWorkspace(true);
    try {
      logWorkspaceTransition("workspace_create_client_started", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        session,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        null,
        null,
      ));
      const createdWorkspace = await createWorkspaceRequest(trimmedName);
      logWorkspaceTransition("workspace_create_client_succeeded", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        session,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        createdWorkspace.workspaceId,
        null,
      ));
      const nextWorkspaces = replaceWorkspaceSummary(availableWorkspaces, createdWorkspace);
      await activateWorkspace(session, nextWorkspaces, createdWorkspace);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      logWorkspaceTransitionError("workspace_create_client_failed", buildWorkspaceInteractionLogDetails(
        sessionVerificationState,
        session,
        activeWorkspace,
        availableWorkspaces,
        cloudSettings,
        null,
        nextErrorMessage,
      ));
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
    if (session === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionVerificationState !== "verified") {
      throw createRemoteActionLockedError(t);
    }

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
      setErrorMessage(nextErrorMessage);
      throw error;
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [
    activeWorkspace,
    availableWorkspaces,
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
    if (session === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionVerificationState !== "verified") {
      throw createRemoteActionLockedError(t);
    }

    setIsChoosingWorkspace(true);
    try {
      logWorkspaceTransition("workspace_delete_client_started", {
        workspaceId,
        selectedWorkspaceId: session.selectedWorkspaceId,
        availableWorkspaceIds: availableWorkspaces.map((workspace) => workspace.workspaceId),
      });
      const response = await deleteWorkspaceRequest(workspaceId, confirmationText);
      logWorkspaceTransition("workspace_delete_client_succeeded", {
        workspaceId,
        deletedWorkspaceId: response.deletedWorkspaceId,
        replacementWorkspaceId: response.workspace.workspaceId,
      });
      const nextWorkspaces = replaceWorkspaceSummary(
        availableWorkspaces.filter((workspace) => workspace.workspaceId !== response.deletedWorkspaceId),
        response.workspace,
      );
      logWorkspaceTransition("workspace_delete_client_preparing_activation", {
        deletedWorkspaceId: response.deletedWorkspaceId,
        replacementWorkspaceId: response.workspace.workspaceId,
        nextWorkspaceIds: nextWorkspaces.map((workspace) => workspace.workspaceId),
      });
      await activateWorkspace(session, nextWorkspaces, response.workspace);
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
      logWorkspaceTransitionError("workspace_delete_client_failed", {
        workspaceId,
        errorMessage: nextErrorMessage,
      });
      setErrorMessage(nextErrorMessage);
      throw error;
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [activateWorkspace, availableWorkspaces, session, sessionVerificationState, t, setErrorMessage, setIsChoosingWorkspace]);

  const loadWorkspaceResetProgressPreview = useCallback(async function loadWorkspaceResetProgressPreview(
    workspaceId: string,
  ): Promise<WorkspaceResetProgressPreview> {
    if (session === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionVerificationState !== "verified") {
      throw createRemoteActionLockedError(t);
    }

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
    if (session === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionVerificationState !== "verified") {
      throw createRemoteActionLockedError(t);
    }

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

  const initializeRef = useRef(initialize);

  useEffect(() => {
    initializeRef.current = initialize;
  }, [initialize]);

  useEffect(() => {
    void initializeRef.current();
  }, []);

  const revalidateActiveSession = useCallback(async function revalidateActiveSession(): Promise<boolean> {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified") {
      return false;
    }

    try {
      const currentSession = await revalidateSessionRequest();
      setSession(currentSession);
      setSessionErrorMessage("");
      setErrorMessage("");
      return true;
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return false;
      }

      throw error;
    }
  }, [sessionLoadState, sessionVerificationState, setSession, setSessionErrorMessage]);

  const runResumeAttempt = useCallback(async function runResumeAttempt(): Promise<void> {
    const isSessionValid = await revalidateActiveSession();
    if (isSessionValid) {
      await runSyncSilently();
    }

    setSessionErrorMessage("");
    setErrorMessage("");
  }, [revalidateActiveSession, runSyncSilently, setErrorMessage, setSessionErrorMessage]);

  const resumeInBackground = useCallback(async function resumeInBackground(): Promise<void> {
    const activeResume = resumePromiseRef.current;
    if (activeResume !== null) {
      return activeResume;
    }

    let trackedResumePromise: Promise<void>;
    trackedResumePromise = (async (): Promise<void> => {
      let attemptNumber = 1;
      let lastError: unknown = null;

      while (attemptNumber <= resumeRetryCount) {
        try {
          await runResumeAttempt();
          return;
        } catch (error) {
          if (isAuthRedirectError(error)) {
            return;
          }

          lastError = error;
          if (attemptNumber === resumeRetryCount) {
            break;
          }

          await waitForDelay(resumeRetryDelayMs);
          attemptNumber += 1;
        }
      }

      const nextErrorMessage = getErrorMessage(lastError);
      setErrorMessage(nextErrorMessage);
      throw lastError;
    })().finally(() => {
      if (resumePromiseRef.current === trackedResumePromise) {
        resumePromiseRef.current = null;
      }
    });

    resumePromiseRef.current = trackedResumePromise;
    return trackedResumePromise;
  }, [runResumeAttempt, setErrorMessage]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified" || session === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }, 60_000);

    const handleResume = (): void => {
      void resumeInBackground();
    };

    const handleFocus = (): void => {
      handleResume();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        handleResume();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [resumeInBackground, runSync, session, sessionLoadState, sessionVerificationState]);

  return {
    initialize,
    chooseWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    loadWorkspaceResetProgressPreview,
    resetWorkspaceProgress,
  };
}
