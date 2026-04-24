import { randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../db";
import { compareLwwMetadata } from "../lww";
import { insertSyncChange } from "../syncChanges";
import {
  forkCardIdForWorkspace,
  forkDeckIdForWorkspace,
  forkReviewEventIdForWorkspace,
} from "../sync/fork";
import {
  ensureSystemWorkspaceReplicaInExecutor,
  ensureWorkspaceReplicaInExecutor,
} from "../syncIdentity";
import {
  deleteGuestWorkspaceContentInExecutor,
  insertGuestCardCopyInExecutor,
  insertGuestDeckCopyInExecutor,
  insertGuestReviewEventCopyInExecutor,
  loadGuestCardsInExecutor,
  loadGuestDecksInExecutor,
  loadGuestReplicasInExecutor,
  loadGuestReviewEventsInExecutor,
  loadWorkspaceSchedulerInExecutor,
  requireMappedReplicaId,
  toSyncClientPlatform,
  updateWorkspaceSchedulerFromGuestInExecutor,
} from "./store";
import type {
  GuestUpgradeHistoryWrite,
  GuestUpgradeSelectionType,
} from "./types";
import { toIsoString } from "./shared";

type GuestEntityIdMaps = Readonly<{
  cardIdMap: ReadonlyMap<string, string>;
  deckIdMap: ReadonlyMap<string, string>;
  reviewEventIdMap: ReadonlyMap<string, string>;
}>;

function schedulerWinnerIsGuest(
  guestScheduler: import("./store").GuestWorkspaceSchedulerRecord,
  targetScheduler: import("./store").GuestWorkspaceSchedulerRecord,
): boolean {
  return compareLwwMetadata({
    clientUpdatedAt: toIsoString(guestScheduler.clientUpdatedAt),
    lastModifiedByReplicaId: guestScheduler.lastModifiedByReplicaId,
    lastOperationId: guestScheduler.lastOperationId,
  }, {
    clientUpdatedAt: toIsoString(targetScheduler.clientUpdatedAt),
    lastModifiedByReplicaId: targetScheduler.lastModifiedByReplicaId,
    lastOperationId: targetScheduler.lastOperationId,
  }) > 0;
}

function requireMappedEntityId(
  entityIdMap: ReadonlyMap<string, string>,
  sourceEntityId: string,
  entityType: string,
): string {
  const targetEntityId = entityIdMap.get(sourceEntityId);
  if (targetEntityId === undefined) {
    throw new Error(`Missing merged ${entityType} id mapping for ${sourceEntityId}`);
  }

  return targetEntityId;
}

function createGuestEntityIdMaps(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  cards: ReadonlyArray<import("./store").GuestCardRecord>,
  decks: ReadonlyArray<import("./store").GuestDeckRecord>,
  reviewEvents: ReadonlyArray<import("./store").GuestReviewEventRecord>,
): GuestEntityIdMaps {
  return {
    cardIdMap: new Map(cards.map((card) => ([
      card.cardId,
      forkCardIdForWorkspace(sourceWorkspaceId, targetWorkspaceId, card.cardId),
    ]))),
    deckIdMap: new Map(decks.map((deck) => ([
      deck.deckId,
      forkDeckIdForWorkspace(sourceWorkspaceId, targetWorkspaceId, deck.deckId),
    ]))),
    reviewEventIdMap: new Map(reviewEvents.map((reviewEvent) => ([
      reviewEvent.reviewEventId,
      forkReviewEventIdForWorkspace(sourceWorkspaceId, targetWorkspaceId, reviewEvent.reviewEventId),
    ]))),
  };
}

async function recreateGuestReplicasInExecutor(
  executor: DatabaseExecutor,
  guestReplicas: ReadonlyArray<import("./store").GuestReplicaRecord>,
  targetUserId: string,
  targetWorkspaceId: string,
): Promise<ReadonlyMap<string, string>> {
  const replicaIdMapEntries: Array<readonly [string, string]> = [];
  for (const replica of guestReplicas) {
    let targetReplicaId: string;

    if (replica.actorKind === "client_installation") {
      if (replica.installationId === null) {
        throw new Error(`Guest replica ${replica.replicaId} is missing installationId`);
      }

      targetReplicaId = await ensureWorkspaceReplicaInExecutor(executor, {
        workspaceId: targetWorkspaceId,
        userId: targetUserId,
        installationId: replica.installationId,
        platform: toSyncClientPlatform(replica.platform),
        appVersion: replica.appVersion,
      });
    } else {
      if (replica.actorKey === null) {
        throw new Error(`Guest replica ${replica.replicaId} is missing actorKey`);
      }

      targetReplicaId = await ensureSystemWorkspaceReplicaInExecutor(executor, {
        workspaceId: targetWorkspaceId,
        userId: targetUserId,
        actorKind: replica.actorKind,
        actorKey: replica.actorKey,
        platform: replica.platform,
        appVersion: replica.appVersion,
      });
    }

    replicaIdMapEntries.push([replica.replicaId, targetReplicaId]);
  }

  return new Map<string, string>(replicaIdMapEntries);
}

async function insertMergedCardsInExecutor(
  executor: DatabaseExecutor,
  sourceWorkspaceId: string,
  targetUserId: string,
  targetWorkspaceId: string,
  cards: ReadonlyArray<import("./store").GuestCardRecord>,
  cardIdMap: ReadonlyMap<string, string>,
  replicaIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  for (const card of cards) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, card.lastModifiedByReplicaId);
    const targetCardId = requireMappedEntityId(cardIdMap, card.cardId, "card");
    const copiedCard: import("./store").GuestCardRecord = {
      ...card,
      cardId: targetCardId,
    };
    await insertGuestCardCopyInExecutor(
      executor,
      targetUserId,
      targetWorkspaceId,
      copiedCard,
      targetReplicaId,
    );
    await insertSyncChange(
      executor,
      targetWorkspaceId,
      "card",
      targetCardId,
      "upsert",
      targetReplicaId,
      `guest-merge-${mergeId}-card-${sourceWorkspaceId}-${targetCardId}`,
      toIsoString(card.clientUpdatedAt),
    );
  }
}

async function insertMergedDecksInExecutor(
  executor: DatabaseExecutor,
  sourceWorkspaceId: string,
  targetUserId: string,
  targetWorkspaceId: string,
  decks: ReadonlyArray<import("./store").GuestDeckRecord>,
  deckIdMap: ReadonlyMap<string, string>,
  replicaIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  for (const deck of decks) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, deck.lastModifiedByReplicaId);
    const targetDeckId = requireMappedEntityId(deckIdMap, deck.deckId, "deck");
    const copiedDeck: import("./store").GuestDeckRecord = {
      ...deck,
      deckId: targetDeckId,
    };
    await insertGuestDeckCopyInExecutor(
      executor,
      targetUserId,
      targetWorkspaceId,
      copiedDeck,
      targetReplicaId,
    );
    await insertSyncChange(
      executor,
      targetWorkspaceId,
      "deck",
      targetDeckId,
      "upsert",
      targetReplicaId,
      `guest-merge-${mergeId}-deck-${sourceWorkspaceId}-${targetDeckId}`,
      toIsoString(deck.clientUpdatedAt),
    );
  }
}

async function insertMergedReviewEventsInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  reviewEvents: ReadonlyArray<import("./store").GuestReviewEventRecord>,
  cardIdMap: ReadonlyMap<string, string>,
  reviewEventIdMap: ReadonlyMap<string, string>,
  replicaIdMap: ReadonlyMap<string, string>,
): Promise<void> {
  for (const reviewEvent of reviewEvents) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, reviewEvent.replicaId);
    const targetCardId = requireMappedEntityId(cardIdMap, reviewEvent.cardId, "card");
    const targetReviewEventId = requireMappedEntityId(
      reviewEventIdMap,
      reviewEvent.reviewEventId,
      "review_event",
    );
    const copiedReviewEvent: import("./store").GuestReviewEventRecord = {
      ...reviewEvent,
      reviewEventId: targetReviewEventId,
      cardId: targetCardId,
    };
    await insertGuestReviewEventCopyInExecutor(
      executor,
      targetUserId,
      targetWorkspaceId,
      copiedReviewEvent,
      targetReplicaId,
    );
  }
}

async function maybeApplyGuestSchedulerInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  guestScheduler: import("./store").GuestWorkspaceSchedulerRecord,
  targetScheduler: import("./store").GuestWorkspaceSchedulerRecord,
  replicaIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  if (!schedulerWinnerIsGuest(guestScheduler, targetScheduler)) {
    return;
  }

  const targetReplicaId = requireMappedReplicaId(replicaIdMap, guestScheduler.lastModifiedByReplicaId);
  await updateWorkspaceSchedulerFromGuestInExecutor(
    executor,
    targetUserId,
    targetWorkspaceId,
    guestScheduler,
    targetReplicaId,
  );
  await insertSyncChange(
    executor,
    targetWorkspaceId,
    "workspace_scheduler_settings",
    targetWorkspaceId,
    "upsert",
    targetReplicaId,
    `guest-merge-${mergeId}-scheduler-${targetWorkspaceId}`,
    toIsoString(guestScheduler.clientUpdatedAt),
  );
}

/**
 * Merges portable guest workspace state into the selected destination workspace
 * and returns the durable replica alias metadata that must be recorded before
 * the live guest rows are deleted.
 *
 * Cards, decks, and review events are deterministically forked into the target
 * workspace so globally keyed entity ids never collide across workspaces.
 */
export async function mergeGuestWorkspaceIntoTargetInExecutor(
  executor: DatabaseExecutor,
  params: Readonly<{
    guestSessionId: string;
    guestUserId: string;
    guestWorkspaceId: string;
    targetSubjectUserId: string;
    targetUserId: string;
    targetWorkspaceId: string;
    selectionType: GuestUpgradeSelectionType;
  }>,
): Promise<GuestUpgradeHistoryWrite> {
  const upgradeId = randomUUID().toLowerCase();
  const guestReplicas = await loadGuestReplicasInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestCards = await loadGuestCardsInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestDecks = await loadGuestDecksInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestReviewEvents = await loadGuestReviewEventsInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestScheduler = await loadWorkspaceSchedulerInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const targetScheduler = await loadWorkspaceSchedulerInExecutor(executor, params.targetUserId, params.targetWorkspaceId);
  const guestEntityIdMaps = createGuestEntityIdMaps(
    params.guestWorkspaceId,
    params.targetWorkspaceId,
    guestCards,
    guestDecks,
    guestReviewEvents,
  );

  await deleteGuestWorkspaceContentInExecutor(executor, params.guestUserId, params.guestWorkspaceId);

  const replicaIdMap = await recreateGuestReplicasInExecutor(
    executor,
    guestReplicas,
    params.targetUserId,
    params.targetWorkspaceId,
  );

  await insertMergedCardsInExecutor(
    executor,
    params.guestWorkspaceId,
    params.targetUserId,
    params.targetWorkspaceId,
    guestCards,
    guestEntityIdMaps.cardIdMap,
    replicaIdMap,
    upgradeId,
  );
  await insertMergedDecksInExecutor(
    executor,
    params.guestWorkspaceId,
    params.targetUserId,
    params.targetWorkspaceId,
    guestDecks,
    guestEntityIdMaps.deckIdMap,
    replicaIdMap,
    upgradeId,
  );
  await insertMergedReviewEventsInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestReviewEvents,
    guestEntityIdMaps.cardIdMap,
    guestEntityIdMaps.reviewEventIdMap,
    replicaIdMap,
  );
  await maybeApplyGuestSchedulerInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestScheduler,
    targetScheduler,
    replicaIdMap,
    upgradeId,
  );

  return {
    upgradeId,
    sourceGuestUserId: params.guestUserId,
    sourceGuestWorkspaceId: params.guestWorkspaceId,
    sourceGuestSessionId: params.guestSessionId,
    targetSubjectUserId: params.targetSubjectUserId,
    targetUserId: params.targetUserId,
    targetWorkspaceId: params.targetWorkspaceId,
    selectionType: params.selectionType,
    replicaIdMap,
  };
}
