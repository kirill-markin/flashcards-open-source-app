import { pullSyncChanges } from "../../../api";
import { webAppVersion } from "../../../clientIdentity";
import {
  applyHotSyncPage,
  loadLastAppliedHotChangeId,
} from "../../../localDb/cards/workspace";
import { syncPageSize } from "./constants";
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
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeReviewSchedule = false;

  while (true) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const pullResult = await pullSyncChanges(
      input.workspaceId,
      input.installationId,
      "web",
      webAppVersion,
      afterHotChangeId,
      syncPageSize,
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    if (await doHotSyncEntriesAffectReviewSchedule(input.workspaceId, pullResult.changes)) {
      didChangeReviewSchedule = true;
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    await applyHotSyncPage(input.workspaceId, pullResult.changes, {
      lastAppliedHotChangeId: pullResult.nextHotChangeId,
      markHotStateHydrated: false,
    });
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
