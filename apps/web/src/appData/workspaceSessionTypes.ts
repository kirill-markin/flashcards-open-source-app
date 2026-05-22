import type { Dispatch, SetStateAction } from "react";
import type { TranslationKey } from "../i18n";
import type {
  CloudSettings,
  ResetWorkspaceProgressResponse,
  SessionInfo,
  WorkspaceResetProgressPreview,
  WorkspaceSummary,
} from "../types";
import type { SessionLoadState } from "./types";
import type { SessionVerificationState } from "./warmStart";

export type WorkspaceSessionState = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
}>;

export type WorkspaceSessionSetters = Readonly<{
  setSessionLoadState: Dispatch<SetStateAction<SessionLoadState>>;
  setSessionVerificationState: Dispatch<SetStateAction<SessionVerificationState>>;
  setSessionErrorMessage: Dispatch<SetStateAction<string>>;
  setSession: Dispatch<SetStateAction<SessionInfo | null>>;
  setActiveWorkspace: Dispatch<SetStateAction<WorkspaceSummary | null>>;
  setAvailableWorkspaces: Dispatch<SetStateAction<ReadonlyArray<WorkspaceSummary>>>;
  setIsChoosingWorkspace: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setCloudSettings: Dispatch<SetStateAction<CloudSettings | null>>;
}>;

export type WorkspaceSessionSyncActions = Readonly<{
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
  runSync: () => Promise<void>;
  runSyncSilently: () => Promise<void>;
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
  discardWorkspaceSync: (workspaceId: string) => void;
  discardAllSyncWork: (runWhileDiscarding: () => Promise<void>) => Promise<void>;
}>;

export type WorkspaceSessionUiActions = Readonly<{
  resetUserScopedUiState: () => void;
}>;

export type UseWorkspaceSessionParams =
  & Readonly<{
    t: (key: TranslationKey) => string;
  }>
  & WorkspaceSessionState
  & WorkspaceSessionSetters
  & WorkspaceSessionSyncActions
  & WorkspaceSessionUiActions;

export type WorkspaceSessionCommands = Readonly<{
  chooseWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string, confirmationText: string) => Promise<void>;
  loadWorkspaceResetProgressPreview: (workspaceId: string) => Promise<WorkspaceResetProgressPreview>;
  resetWorkspaceProgress: (workspaceId: string, confirmationText: string) => Promise<ResetWorkspaceProgressResponse>;
}>;

export type WorkspaceSession = WorkspaceSessionCommands & Readonly<{
  initialize: () => Promise<void>;
}>;

export type WorkspaceSessionActivation = Readonly<{
  activateWorkspace: (
    currentSession: SessionInfo,
    currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
    workspace: WorkspaceSummary,
  ) => Promise<void>;
  resolveInitialWorkspace: (currentSession: SessionInfo) => Promise<void>;
  clearConfirmedUserScopedState: () => Promise<void>;
}>;
