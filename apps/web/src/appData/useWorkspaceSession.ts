import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createWorkspace as createWorkspaceRequest,
  getSession,
  isAuthRedirectError,
  listWorkspaces,
  revalidateSession as revalidateSessionRequest,
  selectWorkspace,
} from "../api";
import { clearAllLocalBrowserData, consumeAccountDeletedMarker } from "../accountDeletion";
import { getStableDeviceIdForUser } from "../clientIdentity";
import { relinkWorkspaceCache } from "../localDb/cache";
import { loadCloudSettings, putCloudSettings } from "../localDb/cloudSettings";
import type { CloudSettings, SessionInfo, WorkspaceSummary } from "../types";
import {
  findWorkspaceById,
  getErrorMessage,
  markSelectedWorkspaces,
  upsertWorkspaceSummary,
} from "./domain";
import type { SessionLoadState } from "./types";

const defaultWorkspaceName = "Personal";

type UseWorkspaceSessionParams = Readonly<{
  sessionLoadState: SessionLoadState;
  session: SessionInfo | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  setSessionLoadState: Dispatch<SetStateAction<SessionLoadState>>;
  setSessionErrorMessage: Dispatch<SetStateAction<string>>;
  setSession: Dispatch<SetStateAction<SessionInfo | null>>;
  setActiveWorkspace: Dispatch<SetStateAction<WorkspaceSummary | null>>;
  setAvailableWorkspaces: Dispatch<SetStateAction<ReadonlyArray<WorkspaceSummary>>>;
  setIsChoosingWorkspace: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setCloudSettings: Dispatch<SetStateAction<CloudSettings | null>>;
  refreshLocalData: () => Promise<void>;
  runSync: () => Promise<void>;
}>;

type WorkspaceSession = Readonly<{
  initialize: () => Promise<void>;
  chooseWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
}>;

function buildLinkingReadyCloudSettings(session: SessionInfo): CloudSettings {
  return {
    deviceId: getStableDeviceIdForUser(session.userId),
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
    deviceId: getStableDeviceIdForUser(session.userId),
    cloudState: "linked",
    linkedUserId: session.userId,
    linkedWorkspaceId: workspaceId,
    linkedEmail: session.profile.email,
    onboardingCompleted: true,
    updatedAt: new Date().toISOString(),
  };
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

/**
 * Bootstraps the authenticated workspace session and hard-resets browser-local
 * state when the persisted cloud settings belong to a different user.
 */
export function useWorkspaceSession(params: UseWorkspaceSessionParams): WorkspaceSession {
  const {
    sessionLoadState,
    session,
    availableWorkspaces,
    setSessionLoadState,
    setSessionErrorMessage,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    setCloudSettings,
    refreshLocalData,
    runSync,
  } = params;

  const activateWorkspace = useCallback(async function activateWorkspace(
    currentSession: SessionInfo,
    currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
    workspace: WorkspaceSummary,
  ): Promise<void> {
    const linkedCloudSettings = buildLinkedCloudSettings(currentSession, workspace.workspaceId);
    await putCloudSettings(linkedCloudSettings);
    await relinkWorkspaceCache(workspace.workspaceId);
    setCloudSettings(linkedCloudSettings);
    await refreshLocalData();

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
    setSessionErrorMessage("");
    setErrorMessage("");
  }, [
    refreshLocalData,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setCloudSettings,
    setErrorMessage,
    setSession,
    setSessionErrorMessage,
    setSessionLoadState,
  ]);

  const resolveInitialWorkspace = useCallback(async function resolveInitialWorkspace(
    currentSession: SessionInfo,
  ): Promise<void> {
    const workspaces = await listWorkspaces();

    if (workspaces.length === 0) {
      // The web app does not persist a local workspace name, so use the same
      // predictable default label for the first explicit remote workspace.
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
    setSessionLoadState("loading");
    setSessionErrorMessage("");
    setErrorMessage("");
    setActiveWorkspace(null);
    setAvailableWorkspaces([]);

    try {
      if (consumeLoggedOutMarker()) {
        await clearAllLocalBrowserData();
      }

      if (consumeAccountDeletedMarker()) {
        await clearAllLocalBrowserData();
        setSession(null);
        setSessionLoadState("deleted");
        setSessionErrorMessage("Your account has been deleted.");
        return;
      }

      const currentSession = await getSession();
      const persistedCloudSettings = await loadCloudSettings();
      if (
        persistedCloudSettings !== null
        && persistedCloudSettings.linkedUserId !== null
        && persistedCloudSettings.linkedUserId !== currentSession.userId
      ) {
        await clearAllLocalBrowserData();
      }

      const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession);
      await putCloudSettings(linkingReadyCloudSettings);
      setCloudSettings(linkingReadyCloudSettings);
      await resolveInitialWorkspace(currentSession);
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
    setActiveWorkspace,
    setAvailableWorkspaces,
    setCloudSettings,
    setErrorMessage,
    setSessionErrorMessage,
    setSessionLoadState,
  ]);

  const chooseWorkspace = useCallback(async function chooseWorkspace(workspaceId: string): Promise<void> {
    if (session === null) {
      throw new Error("Session is unavailable");
    }

    setIsChoosingWorkspace(true);
    try {
      const selectedWorkspace = await selectWorkspace(workspaceId);
      await activateWorkspace(session, availableWorkspaces, selectedWorkspace);
      setErrorMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [activateWorkspace, availableWorkspaces, session, setErrorMessage, setIsChoosingWorkspace]);

  const createWorkspace = useCallback(async function createWorkspace(name: string): Promise<void> {
    if (session === null) {
      throw new Error("Session is unavailable");
    }

    const trimmedName = name.trim();
    if (trimmedName === "") {
      throw new Error("Workspace name is required");
    }

    setIsChoosingWorkspace(true);
    try {
      const createdWorkspace = await createWorkspaceRequest(trimmedName);
      const nextWorkspaces = upsertWorkspaceSummary(availableWorkspaces, createdWorkspace);
      await activateWorkspace(session, nextWorkspaces, createdWorkspace);
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
  }, [activateWorkspace, availableWorkspaces, session, setErrorMessage, setIsChoosingWorkspace]);

  const initializeRef = useRef(initialize);

  useEffect(() => {
    initializeRef.current = initialize;
  }, [initialize]);

  useEffect(() => {
    // Bootstrap only on mount. Re-running initialize after session/workspace
    // state updates resets the whole app back to the top-level loading screen.
    void initializeRef.current();
  }, []);

  /**
   * Revalidates the browser session when the tab resumes so background sync
   * never keeps using an expired cookie/CSRF pair after a long idle period.
   */
  const revalidateActiveSession = useCallback(async function revalidateActiveSession(): Promise<boolean> {
    if (sessionLoadState !== "ready") {
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

      setErrorMessage(getErrorMessage(error));
      throw error;
    }
  }, [sessionLoadState, setErrorMessage, setSession, setSessionErrorMessage]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }, 60_000);

    const handleResume = (): void => {
      void (async (): Promise<void> => {
        const isSessionValid = await revalidateActiveSession();
        if (isSessionValid) {
          await runSync();
        }
      })();
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
  }, [revalidateActiveSession, runSync, session, sessionLoadState]);

  return {
    initialize,
    chooseWorkspace,
    createWorkspace,
  };
}
