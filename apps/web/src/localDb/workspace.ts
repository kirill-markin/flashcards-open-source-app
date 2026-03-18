import type {
  WorkspaceOverviewSnapshot,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
  WorkspaceTagsSummary,
} from "../types";
import { iterateAllCardTags } from "./cardTags";
import { loadActiveCardCountWithDatabase } from "./cards";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
  type WorkspaceSettingsRecord,
  type WorkspaceSyncStateRecord,
} from "./core";
import { loadDecksListSnapshot } from "./decks";

function compareTagSummaries(
  leftTag: Readonly<{ tag: string; cardsCount: number }>,
  rightTag: Readonly<{ tag: string; cardsCount: number }>,
): number {
  if (leftTag.cardsCount !== rightTag.cardsCount) {
    return rightTag.cardsCount - leftTag.cardsCount;
  }

  return leftTag.tag.localeCompare(rightTag.tag, undefined, { sensitivity: "base" });
}

function buildWorkspaceSyncStateRecord(
  workspaceId: string,
  currentRecord: WorkspaceSyncStateRecord | undefined,
  input: Readonly<{
    lastAppliedHotChangeId: number;
    lastAppliedReviewSequenceId: number;
    hasHydratedHotState: boolean;
    hasHydratedReviewHistory: boolean;
  }>,
): WorkspaceSyncStateRecord {
  return {
    workspaceId,
    lastAppliedHotChangeId: input.lastAppliedHotChangeId,
    lastAppliedReviewSequenceId: input.lastAppliedReviewSequenceId,
    hasHydratedHotState: input.hasHydratedHotState,
    hasHydratedReviewHistory: input.hasHydratedReviewHistory,
    hotStateHydratedAt: input.hasHydratedHotState
      ? currentRecord?.hotStateHydratedAt ?? new Date().toISOString()
      : null,
    reviewHistoryHydratedAt: input.hasHydratedReviewHistory
      ? currentRecord?.reviewHistoryHydratedAt ?? new Date().toISOString()
      : null,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadWorkspaceSettings(workspaceId: string): Promise<WorkspaceSchedulerSettings | null> {
  const workspaceSettingsRecord = await closeDatabaseAfter((database) => getFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings", workspaceId));
  return workspaceSettingsRecord?.settings ?? null;
}

export async function loadWorkspaceSyncState(workspaceId: string): Promise<WorkspaceSyncStateRecord | null> {
  const syncState = await closeDatabaseAfter((database) => getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId));
  return syncState ?? null;
}

export async function loadLastAppliedHotChangeId(workspaceId: string): Promise<number> {
  return (await loadWorkspaceSyncState(workspaceId))?.lastAppliedHotChangeId ?? 0;
}

export async function loadLastAppliedReviewSequenceId(workspaceId: string): Promise<number> {
  return (await loadWorkspaceSyncState(workspaceId))?.lastAppliedReviewSequenceId ?? 0;
}

export async function hasHydratedHotState(workspaceId: string): Promise<boolean> {
  return (await loadWorkspaceSyncState(workspaceId))?.hasHydratedHotState ?? false;
}

export async function hasHydratedReviewHistory(workspaceId: string): Promise<boolean> {
  return (await loadWorkspaceSyncState(workspaceId))?.hasHydratedReviewHistory ?? false;
}

export async function loadWorkspaceTagsSummary(workspaceId: string): Promise<WorkspaceTagsSummary> {
  return closeDatabaseAfter(async (database) => {
    const counts = new Map<string, number>();
    await iterateAllCardTags(database, workspaceId, (record) => {
      counts.set(record.tag, (counts.get(record.tag) ?? 0) + 1);
      return true;
    });

    return {
      tags: [...counts.entries()]
        .map(([tag, cardsCount]) => ({
          tag,
          cardsCount,
        }))
        .sort(compareTagSummaries),
      totalCards: await loadActiveCardCountWithDatabase(database, workspaceId),
    };
  });
}

export async function loadWorkspaceOverviewSnapshot(workspace: WorkspaceSummary): Promise<WorkspaceOverviewSnapshot> {
  const [tagsSummary, decksSnapshot] = await Promise.all([
    loadWorkspaceTagsSummary(workspace.workspaceId),
    loadDecksListSnapshot(workspace.workspaceId),
  ]);

  return {
    workspaceName: workspace.name,
    deckCount: decksSnapshot.deckSummaries.length,
    tagsCount: tagsSummary.tags.length,
    totalCards: decksSnapshot.allCardsStats.totalCards,
    dueCount: decksSnapshot.allCardsStats.dueCards,
    newCount: decksSnapshot.allCardsStats.newCards,
    reviewedCount: decksSnapshot.allCardsStats.reviewedCards,
  };
}

export async function putWorkspaceSettings(workspaceId: string, settings: WorkspaceSchedulerSettings): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["workspaceSettings"], (transaction) => transaction.objectStore("workspaceSettings").put({
      workspaceId,
      settings,
    } satisfies WorkspaceSettingsRecord));
  });
}

export async function setLastAppliedHotChangeId(workspaceId: string, lastAppliedHotChangeId: number): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => transaction.objectStore("workspaceSyncState").put(
      buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId,
        lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
        hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
        hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
      }),
    ));
  });
}

export async function setLastAppliedReviewSequenceId(workspaceId: string, lastAppliedReviewSequenceId: number): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => transaction.objectStore("workspaceSyncState").put(
      buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
        lastAppliedReviewSequenceId,
        hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
        hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
      }),
    ));
  });
}

export async function setHotStateHydrated(workspaceId: string, hasHydratedHotState: boolean): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => transaction.objectStore("workspaceSyncState").put(
      buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
        lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
        hasHydratedHotState,
        hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
      }),
    ));
  });
}

export async function setReviewHistoryHydrated(workspaceId: string, hasHydratedReviewHistory: boolean): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => transaction.objectStore("workspaceSyncState").put(
      buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
        lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
        hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
        hasHydratedReviewHistory,
      }),
    ));
  });
}
