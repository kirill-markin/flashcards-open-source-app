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
    lastAppliedChangeId: number;
    hasHydrated: boolean;
  }>,
): WorkspaceSyncStateRecord {
  return {
    workspaceId,
    lastAppliedChangeId: input.lastAppliedChangeId,
    hasHydrated: input.hasHydrated,
    hydratedAt: input.hasHydrated
      ? currentRecord?.hydratedAt ?? new Date().toISOString()
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

export async function loadLastAppliedChangeId(workspaceId: string): Promise<number> {
  return (await loadWorkspaceSyncState(workspaceId))?.lastAppliedChangeId ?? 0;
}

export async function hasHydratedWorkspace(workspaceId: string): Promise<boolean> {
  return (await loadWorkspaceSyncState(workspaceId))?.hasHydrated ?? false;
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

export async function setLastAppliedChangeId(workspaceId: string, lastAppliedChangeId: number): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => transaction.objectStore("workspaceSyncState").put(
      buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedChangeId,
        hasHydrated: currentRecord?.hasHydrated ?? false,
      }),
    ));
  });
}

export async function setWorkspaceHydrated(workspaceId: string, hasHydrated: boolean): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => transaction.objectStore("workspaceSyncState").put(
      buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedChangeId: currentRecord?.lastAppliedChangeId ?? 0,
        hasHydrated,
      }),
    ));
  });
}
