import { bootstrapHotState } from "./bootstrapHotState";
import { pullHotChanges } from "./pullHotChanges";
import { pullReviewHistory } from "./pullReviewHistory";
import { pushOutbox } from "./pushOutbox";
import {
  createEmptyRemoteSyncFlags,
  mergeRemoteSyncFlags,
} from "./syncFlags";
import type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

export type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

export async function runWorkspaceRemoteSync(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let syncFlags = createEmptyRemoteSyncFlags();
  syncFlags = mergeRemoteSyncFlags(syncFlags, await bootstrapHotState(input));
  syncFlags = mergeRemoteSyncFlags(syncFlags, await pushOutbox(input));
  syncFlags = mergeRemoteSyncFlags(syncFlags, await pullHotChanges(input));
  syncFlags = mergeRemoteSyncFlags(syncFlags, await pullReviewHistory(input));
  return syncFlags;
}
