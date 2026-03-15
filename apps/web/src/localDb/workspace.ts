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
  getAllFromStore,
  getFromStore,
  runReadwrite,
  SyncStateRecord,
  WorkspaceSettingsRecord,
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

export async function loadWorkspaceSettings(): Promise<WorkspaceSchedulerSettings | null> {
  const workspaceSettingsRecords = await closeDatabaseAfter((database) => getAllFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings"));
  return workspaceSettingsRecords[0]?.settings ?? null;
}

export async function loadLastAppliedChangeId(): Promise<number> {
  const syncState = await closeDatabaseAfter((database) => getFromStore<SyncStateRecord>(database, "meta", "sync_state"));
  return syncState?.lastAppliedChangeId ?? 0;
}

export async function loadWorkspaceTagsSummary(): Promise<WorkspaceTagsSummary> {
  return closeDatabaseAfter(async (database) => {
    const counts = new Map<string, number>();
    await iterateAllCardTags(database, (record) => {
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
      totalCards: await loadActiveCardCountWithDatabase(database),
    };
  });
}

export async function loadWorkspaceOverviewSnapshot(workspace: WorkspaceSummary): Promise<WorkspaceOverviewSnapshot> {
  const [tagsSummary, decksSnapshot] = await Promise.all([
    loadWorkspaceTagsSummary(),
    loadDecksListSnapshot(),
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

export async function putWorkspaceSettings(settings: WorkspaceSchedulerSettings): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["workspaceSettings"], (transaction) => transaction.objectStore("workspaceSettings").put({
      id: "workspace",
      settings,
    } satisfies WorkspaceSettingsRecord));
  });
}

export async function setLastAppliedChangeId(workspaceId: string, lastAppliedChangeId: number): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put({
      key: "sync_state",
      workspaceId,
      lastAppliedChangeId,
      updatedAt: new Date().toISOString(),
    } satisfies SyncStateRecord));
  });
}
