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
  if (input.hasFailed()) {
    return syncFlags;
  }

  syncFlags = mergeRemoteSyncFlags(syncFlags, await bootstrapHotState(input));
  if (input.hasFailed()) {
    return syncFlags;
  }

  syncFlags = mergeRemoteSyncFlags(syncFlags, await pushOutbox(input));
  if (input.hasFailed()) {
    return syncFlags;
  }

  syncFlags = mergeRemoteSyncFlags(syncFlags, await pullHotChanges(input));
  if (input.hasFailed()) {
    return syncFlags;
  }

  syncFlags = mergeRemoteSyncFlags(syncFlags, await pullReviewHistory(input));
  return syncFlags;
}
