import type {
  SyncBootstrapEntry,
  SyncChange,
  WorkspaceSchedulerSettings,
} from "../../../types";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";

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
  signal: AbortSignal;
  hasFailed: () => boolean;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  // True when this workspace is the only one the account owns, which is the user-scoped
  // signal for a brand-new user. Resolved by the sync engine from the account's workspace
  // list, because remote sync itself only ever sees one workspace.
  isOnlyWorkspaceForUser: boolean;
  requireWorkspaceSyncNotDiscarded: (workspaceId: string) => void;
  publishWorkspaceSettings: (workspaceId: string, settings: WorkspaceSchedulerSettings) => void;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
}>;
