import type {
  SyncBootstrapEntry,
  SyncChange,
  WorkspaceSchedulerSettings,
} from "../../../types";

export type HotSyncEntry = SyncBootstrapEntry | SyncChange;
export type CardHotSyncEntry = Extract<HotSyncEntry, Readonly<{ entityType: "card" }>>;

export type RemoteSyncFlags = Readonly<{
  didChangeProgressHistory: boolean;
  didChangeReviewSchedule: boolean;
}>;

export type WorkspaceRemoteSyncInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  syncRunId: string;
  requireWorkspaceSyncNotDiscarded: (workspaceId: string) => void;
  publishWorkspaceSettings: (workspaceId: string, settings: WorkspaceSchedulerSettings) => void;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
}>;
