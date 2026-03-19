import type {
  ReviewEvent,
  SyncBootstrapEntry,
  WorkspaceOverviewSnapshot,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
  WorkspaceTagsSummary,
} from "../types";
import { iterateAllCardTags } from "./cardTags";
import { loadActiveCardCountWithDatabase, putCardInTransaction } from "./cards";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  type DatabaseStores,
  getFromStore,
  runReadwrite,
  type WorkspaceSettingsRecord,
  type WorkspaceSyncStateRecord,
} from "./core";
import { loadDecksListSnapshot, putDeckInTransaction } from "./decks";
import { putReviewEventInTransaction } from "./reviews";

type HotSyncStateUpdate = Readonly<{
  lastAppliedHotChangeId: number;
  markHotStateHydrated: boolean;
}>;

type ReviewHistorySyncStateUpdate = Readonly<{
  lastAppliedReviewSequenceId: number;
  markReviewHistoryHydrated: boolean;
}>;

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

function buildHotSyncStateRecord(
  workspaceId: string,
  currentRecord: WorkspaceSyncStateRecord | undefined,
  syncStateUpdate: HotSyncStateUpdate,
): WorkspaceSyncStateRecord {
  return buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
    lastAppliedHotChangeId: syncStateUpdate.lastAppliedHotChangeId,
    lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
    hasHydratedHotState: (currentRecord?.hasHydratedHotState ?? false) || syncStateUpdate.markHotStateHydrated,
    hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
  });
}

function buildReviewHistorySyncStateRecord(
  workspaceId: string,
  currentRecord: WorkspaceSyncStateRecord | undefined,
  syncStateUpdate: ReviewHistorySyncStateUpdate,
): WorkspaceSyncStateRecord {
  return buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
    lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
    lastAppliedReviewSequenceId: syncStateUpdate.lastAppliedReviewSequenceId,
    hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
    hasHydratedReviewHistory: (currentRecord?.hasHydratedReviewHistory ?? false) || syncStateUpdate.markReviewHistoryHydrated,
  });
}

function putWorkspaceSettingsInTransaction(
  transaction: IDBTransaction,
  workspaceId: string,
  settings: WorkspaceSchedulerSettings,
): void {
  transaction.objectStore("workspaceSettings").put({
    workspaceId,
    settings,
  } satisfies WorkspaceSettingsRecord);
}

function putWorkspaceSyncStateInTransaction(
  transaction: IDBTransaction,
  nextRecord: WorkspaceSyncStateRecord,
): void {
  transaction.objectStore("workspaceSyncState").put(nextRecord);
}

function createHotSyncStoreNames(syncStateUpdate: HotSyncStateUpdate | null): ReadonlyArray<DatabaseStores> {
  return syncStateUpdate === null
    ? ["cards", "cardTags", "decks", "workspaceSettings"]
    : ["cards", "cardTags", "decks", "workspaceSettings", "workspaceSyncState"];
}

function createReviewSyncStoreNames(): ReadonlyArray<DatabaseStores> {
  return ["reviewEvents", "workspaceSyncState"];
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

export async function applyHotSyncPage(
  workspaceId: string,
  entries: ReadonlyArray<SyncBootstrapEntry>,
  syncStateUpdate: HotSyncStateUpdate | null,
): Promise<void> {
  await closeDatabaseAfter(async (database) => {
    const currentRecord = syncStateUpdate === null
      ? undefined
      : await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);

    await runReadwrite(database, createHotSyncStoreNames(syncStateUpdate), (transaction) => {
      for (const entry of entries) {
        if (entry.entityType === "card") {
          putCardInTransaction(transaction, workspaceId, entry.payload);
          continue;
        }

        if (entry.entityType === "deck") {
          if (entry.payload.workspaceId !== workspaceId) {
            throw new Error(`Deck sync payload workspace mismatch: ${entry.payload.workspaceId}`);
          }

          putDeckInTransaction(transaction, entry.payload);
          continue;
        }

        putWorkspaceSettingsInTransaction(transaction, workspaceId, entry.payload);
      }

      if (syncStateUpdate !== null) {
        putWorkspaceSyncStateInTransaction(
          transaction,
          buildHotSyncStateRecord(workspaceId, currentRecord, syncStateUpdate),
        );
      }

      return null;
    });
  });
}

export async function applyReviewHistorySyncPage(
  workspaceId: string,
  reviewEvents: ReadonlyArray<ReviewEvent>,
  syncStateUpdate: ReviewHistorySyncStateUpdate,
): Promise<void> {
  await closeDatabaseAfter(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);

    await runReadwrite(database, createReviewSyncStoreNames(), (transaction) => {
      for (const reviewEvent of reviewEvents) {
        if (reviewEvent.workspaceId !== workspaceId) {
          throw new Error(`Review event sync payload workspace mismatch: ${reviewEvent.workspaceId}`);
        }

        putReviewEventInTransaction(transaction, reviewEvent);
      }

      putWorkspaceSyncStateInTransaction(
        transaction,
        buildReviewHistorySyncStateRecord(workspaceId, currentRecord, syncStateUpdate),
      );
      return null;
    });
  });
}

export async function putWorkspaceSettings(workspaceId: string, settings: WorkspaceSchedulerSettings): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["workspaceSettings"], (transaction) => {
      putWorkspaceSettingsInTransaction(transaction, workspaceId, settings);
      return null;
    });
  });
}

export async function setLastAppliedHotChangeId(workspaceId: string, lastAppliedHotChangeId: number): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => {
      putWorkspaceSyncStateInTransaction(transaction, buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId,
        lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
        hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
        hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
      }));
      return null;
    });
  });
}

export async function setLastAppliedReviewSequenceId(workspaceId: string, lastAppliedReviewSequenceId: number): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => {
      putWorkspaceSyncStateInTransaction(transaction, buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
        lastAppliedReviewSequenceId,
        hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
        hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
      }));
      return null;
    });
  });
}

export async function setHotStateHydrated(workspaceId: string, hasHydratedHotState: boolean): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => {
      putWorkspaceSyncStateInTransaction(transaction, buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
        lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
        hasHydratedHotState,
        hasHydratedReviewHistory: currentRecord?.hasHydratedReviewHistory ?? false,
      }));
      return null;
    });
  });
}

export async function setReviewHistoryHydrated(workspaceId: string, hasHydratedReviewHistory: boolean): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    const currentRecord = await getFromStore<WorkspaceSyncStateRecord>(database, "workspaceSyncState", workspaceId);
    await runReadwrite(database, ["workspaceSyncState"], (transaction) => {
      putWorkspaceSyncStateInTransaction(transaction, buildWorkspaceSyncStateRecord(workspaceId, currentRecord, {
        lastAppliedHotChangeId: currentRecord?.lastAppliedHotChangeId ?? 0,
        lastAppliedReviewSequenceId: currentRecord?.lastAppliedReviewSequenceId ?? 0,
        hasHydratedHotState: currentRecord?.hasHydratedHotState ?? false,
        hasHydratedReviewHistory,
      }));
      return null;
    });
  });
}
