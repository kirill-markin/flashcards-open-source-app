import type {
  Card,
  CloudSettings,
  Deck,
  ReviewEvent,
  WorkspaceSchedulerSettings,
} from "../types";
import { putCardTagRecords } from "./cardTags";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  CloudSettingsRecord,
  getAllFromStore,
  getFromStore,
  runReadwrite,
  SyncStateRecord,
  WorkspaceSettingsRecord,
} from "./core";
import type { PersistedOutboxRecord } from "./outbox";

type WebSyncCache = Readonly<{
  workspaceId: string | null;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewEvents: ReadonlyArray<ReviewEvent>;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  cloudSettings: CloudSettings | null;
  outbox: ReadonlyArray<PersistedOutboxRecord>;
  lastAppliedChangeId: number;
}>;

async function readWebSyncCache(): Promise<WebSyncCache> {
  return closeDatabaseAfter(async (database) => {
    const [cards, decks, reviewEvents, workspaceSettingsRecords, outbox, syncState, cloudSettingsRecord] = await Promise.all([
      getAllFromStore<Card>(database, "cards"),
      getAllFromStore<Deck>(database, "decks"),
      getAllFromStore<ReviewEvent>(database, "reviewEvents"),
      getAllFromStore<WorkspaceSettingsRecord>(database, "workspaceSettings"),
      getAllFromStore<PersistedOutboxRecord>(database, "outbox"),
      getFromStore<SyncStateRecord>(database, "meta", "sync_state"),
      getFromStore<CloudSettingsRecord>(database, "meta", "cloud_settings"),
    ]);

    return {
      workspaceId: syncState?.workspaceId ?? null,
      cards,
      decks,
      reviewEvents: [...reviewEvents].sort((left, right) => right.reviewedAtServer.localeCompare(left.reviewedAtServer)),
      workspaceSettings: workspaceSettingsRecords[0]?.settings ?? null,
      cloudSettings: cloudSettingsRecord?.settings ?? null,
      outbox: [...outbox].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      lastAppliedChangeId: syncState?.lastAppliedChangeId ?? 0,
    };
  });
}

export async function relinkWorkspaceCache(workspaceId: string): Promise<void> {
  const cache = await readWebSyncCache();
  if (cache.workspaceId === workspaceId) {
    return;
  }

  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(
      database,
      ["cards", "cardTags", "decks", "reviewEvents", "workspaceSettings", "outbox", "meta"],
      (transaction) => {
        const cardsStore = transaction.objectStore("cards");
        const cardTagsStore = transaction.objectStore("cardTags");
        const decksStore = transaction.objectStore("decks");
        const reviewEventsStore = transaction.objectStore("reviewEvents");
        const workspaceSettingsStore = transaction.objectStore("workspaceSettings");
        const outboxStore = transaction.objectStore("outbox");
        const metaStore = transaction.objectStore("meta");

        cardsStore.clear();
        cardTagsStore.clear();
        decksStore.clear();
        reviewEventsStore.clear();
        workspaceSettingsStore.clear();
        outboxStore.clear();

        for (const card of cache.cards) {
          cardsStore.put(card);
          putCardTagRecords(cardTagsStore, card);
        }

        for (const deck of cache.decks) {
          decksStore.put({
            ...deck,
            workspaceId,
          } satisfies Deck);
        }

        for (const reviewEvent of cache.reviewEvents) {
          reviewEventsStore.put({
            ...reviewEvent,
            workspaceId,
          } satisfies ReviewEvent);
        }

        if (cache.workspaceSettings !== null) {
          workspaceSettingsStore.put({
            id: "workspace",
            settings: cache.workspaceSettings,
          } satisfies WorkspaceSettingsRecord);
        }

        for (const record of cache.outbox) {
          outboxStore.put({
            ...record,
            workspaceId,
          } satisfies PersistedOutboxRecord);
        }

        metaStore.put({
          key: "sync_state",
          workspaceId,
          lastAppliedChangeId: 0,
          updatedAt: new Date().toISOString(),
        } satisfies SyncStateRecord);
        if (cache.cloudSettings !== null) {
          metaStore.put({
            key: "cloud_settings",
            settings: {
              ...cache.cloudSettings,
              linkedWorkspaceId: cache.cloudSettings.linkedWorkspaceId === null ? null : workspaceId,
            },
          } satisfies CloudSettingsRecord);
        }
        return null;
      },
    );
  });
}

export async function clearWebSyncCache(): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(
      database,
      ["cards", "cardTags", "decks", "reviewEvents", "workspaceSettings", "outbox", "meta"],
      (transaction) => {
        transaction.objectStore("cards").clear();
        transaction.objectStore("cardTags").clear();
        transaction.objectStore("decks").clear();
        transaction.objectStore("reviewEvents").clear();
        transaction.objectStore("workspaceSettings").clear();
        transaction.objectStore("outbox").clear();
        transaction.objectStore("meta").clear();
        return null;
      },
    );
  });
}
