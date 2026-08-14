import { pullSyncChanges } from "../../../api";
import { webAppVersion } from "../../../clientIdentity";
import {
  applyHotSyncPage,
  loadLastAppliedHotChangeId,
} from "../../../localDb/cards/workspace";
import { syncIncrementalPageSize } from "./constants";
import {
  doHotSyncEntriesAffectReviewSchedule,
  publishWorkspaceSettingsFromEntries,
} from "./hotSyncEntries";
import type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

export async function pullHotChanges(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let afterHotChangeId = await loadLastAppliedHotChangeId(input.workspaceId);
  if (input.hasFailed()) {
    return {
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    };
  }
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeReviewSchedule = false;

  while (true) {
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const pullResult = await pullSyncChanges(
      input.workspaceId,
      input.installationId,
      "web",
      webAppVersion,
      afterHotChangeId,
      syncIncrementalPageSize,
      true,
      input.signal,
    );
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    if (await doHotSyncEntriesAffectReviewSchedule(input.workspaceId, pullResult.changes)) {
      didChangeReviewSchedule = true;
    }
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    await applyHotSyncPage(input.workspaceId, pullResult.changes, {
      lastAppliedHotChangeId: pullResult.nextHotChangeId,
      markHotStateHydrated: false,
    });
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    publishWorkspaceSettingsFromEntries(input, pullResult.changes);

    afterHotChangeId = pullResult.nextHotChangeId;

    if (pullResult.hasMore === false) {
      break;
    }
  }

  return {
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}
