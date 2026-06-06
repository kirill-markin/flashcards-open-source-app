import { pullReviewHistorySync } from "../../../api";
import { webAppVersion } from "../../../clientIdentity";
import {
  applyReviewHistorySyncPage,
  hasHydratedReviewHistory,
  loadLastAppliedReviewSequenceId,
} from "../../../localDb/cards/workspace";
import { syncIncrementalPageSize } from "./constants";
import type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

export async function pullReviewHistory(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let afterReviewSequenceId = await loadLastAppliedReviewSequenceId(input.workspaceId);
  const reviewHistoryHydrated = await hasHydratedReviewHistory(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeProgressHistory = false;

  while (true) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const reviewHistoryResult = await pullReviewHistorySync(
      input.workspaceId,
      input.installationId,
      "web",
      webAppVersion,
      afterReviewSequenceId,
      syncIncrementalPageSize,
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    await applyReviewHistorySyncPage(input.workspaceId, reviewHistoryResult.reviewEvents, {
      lastAppliedReviewSequenceId: reviewHistoryResult.nextReviewSequenceId,
      markReviewHistoryHydrated: reviewHistoryHydrated === false && reviewHistoryResult.hasMore === false,
    });
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    if (reviewHistoryResult.reviewEvents.length > 0) {
      didChangeProgressHistory = true;
    }

    afterReviewSequenceId = reviewHistoryResult.nextReviewSequenceId;

    if (reviewHistoryResult.hasMore === false) {
      break;
    }
  }

  return {
    didChangeProgressHistory,
    didChangeReviewSchedule: false,
  };
}
