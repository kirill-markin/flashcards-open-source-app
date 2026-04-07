import { randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../db";
import { compareLwwMetadata } from "../lww";
import { insertSyncChange } from "../syncChanges";
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
  targetUserId: string,
  targetWorkspaceId: string,
  cards: ReadonlyArray<import("./store").GuestCardRecord>,
  replicaIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  for (const card of cards) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, card.lastModifiedByReplicaId);
    await insertGuestCardCopyInExecutor(
      executor,
      targetUserId,
      targetWorkspaceId,
      card,
      targetReplicaId,
    );
    await insertSyncChange(
      executor,
      targetWorkspaceId,
      "card",
      card.cardId,
      "upsert",
      targetReplicaId,
      `guest-merge-${mergeId}-card-${card.cardId}`,
      toIsoString(card.clientUpdatedAt),
    );
  }
}

async function insertMergedDecksInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  decks: ReadonlyArray<import("./store").GuestDeckRecord>,
  replicaIdMap: ReadonlyMap<string, string>,
  mergeId: string,
): Promise<void> {
  for (const deck of decks) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, deck.lastModifiedByReplicaId);
    await insertGuestDeckCopyInExecutor(
      executor,
      targetUserId,
      targetWorkspaceId,
      deck,
      targetReplicaId,
    );
    await insertSyncChange(
      executor,
      targetWorkspaceId,
      "deck",
      deck.deckId,
      "upsert",
      targetReplicaId,
      `guest-merge-${mergeId}-deck-${deck.deckId}`,
      toIsoString(deck.clientUpdatedAt),
    );
  }
}

async function insertMergedReviewEventsInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  reviewEvents: ReadonlyArray<import("./store").GuestReviewEventRecord>,
  replicaIdMap: ReadonlyMap<string, string>,
): Promise<void> {
  for (const reviewEvent of reviewEvents) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, reviewEvent.replicaId);
    await insertGuestReviewEventCopyInExecutor(
      executor,
      targetUserId,
      targetWorkspaceId,
      reviewEvent,
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
 * and returns the durable alias metadata that must be recorded before the live
 * guest rows are deleted.
 *
 * V1 intentionally preserves only correlation metadata for future debugging.
 * Guest-only chat rows and other cascade-deleted live records still disappear
 * during cleanup and are not copied here.
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

  await deleteGuestWorkspaceContentInExecutor(executor, params.guestUserId, params.guestWorkspaceId);

  const replicaIdMap = await recreateGuestReplicasInExecutor(
    executor,
    guestReplicas,
    params.targetUserId,
    params.targetWorkspaceId,
  );

  await insertMergedCardsInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestCards,
    replicaIdMap,
    upgradeId,
  );
  await insertMergedDecksInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestDecks,
    replicaIdMap,
    upgradeId,
  );
  await insertMergedReviewEventsInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    guestReviewEvents,
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
