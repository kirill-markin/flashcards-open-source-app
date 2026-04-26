import { randomUUID } from "node:crypto";
import {
  appendReviewEventSnapshotInExecutor,
  getInvalidFsrsStateReason,
  upsertCardSnapshotInExecutor,
  type CardMutationMetadata,
  type CardSnapshotInput,
  type ReviewEvent,
} from "../cards";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../db";
import {
  HttpError,
  type SyncConflictEntityType,
} from "../errors";
import {
  compareLwwMetadata,
} from "../lww";
import {
  upsertDeckSnapshotInExecutor,
  type DeckMutationMetadata,
  type DeckSnapshotInput,
} from "../decks";
import { insertSyncChange } from "../syncChanges";
import {
  ensureSystemWorkspaceReplicaInExecutor,
  ensureWorkspaceReplicaInExecutor,
} from "../syncIdentity";
import { SYNC_WORKSPACE_FORK_REQUIRED } from "../sync/fork";
import {
  deleteGuestWorkspaceContentInExecutor,
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
  GuestUpgradeDroppedEntities,
  GuestUpgradeHistoryWrite,
  GuestUpgradeSelectionType,
} from "./types";
import { toIsoString } from "./shared";

type GuestMergeWriteInput = Readonly<{
  entityType: SyncConflictEntityType;
  entityId: string;
  sourceGuestWorkspaceId: string;
  targetWorkspaceId: string;
  supportsDroppedEntities: boolean;
  write: () => Promise<boolean>;
}>;

type GuestMergeDroppedEntitiesAccumulator = {
  cardIds: Array<string>;
  deckIds: Array<string>;
  reviewEventIds: Array<string>;
};

type GuestMergeResult = Readonly<{
  history: GuestUpgradeHistoryWrite;
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

function createGuestMutationMetadata(
  clientUpdatedAt: Date | string,
  lastModifiedByReplicaId: string,
  lastOperationId: string,
): CardMutationMetadata {
  return {
    clientUpdatedAt: toIsoString(clientUpdatedAt),
    lastModifiedByReplicaId,
    lastOperationId,
  };
}

function createCardSnapshotInput(
  card: import("./store").GuestCardRecord,
): CardSnapshotInput {
  return {
    cardId: card.cardId,
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
    effortLevel: card.effortLevel,
    dueAt: card.dueAt === null ? null : toIsoString(card.dueAt),
    createdAt: toIsoString(card.createdAt),
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrsCardState,
    fsrsStepIndex: card.fsrsStepIndex,
    fsrsStability: card.fsrsStability,
    fsrsDifficulty: card.fsrsDifficulty,
    fsrsLastReviewedAt: card.fsrsLastReviewedAt === null ? null : toIsoString(card.fsrsLastReviewedAt),
    fsrsScheduledDays: card.fsrsScheduledDays,
    deletedAt: card.deletedAt === null ? null : toIsoString(card.deletedAt),
  };
}

function logGuestMergeFsrsStateReset(
  workspaceId: string,
  cardId: string,
  reason: string,
): void {
  console.error(JSON.stringify({
    domain: "cards",
    action: "reset_invalid_fsrs_state",
    workspaceId,
    cardId,
    reason,
    repair: "reset",
  }));
}

function repairGuestCardSnapshotInput(
  workspaceId: string,
  card: CardSnapshotInput,
): CardSnapshotInput {
  const invalidReason = getInvalidFsrsStateReason({
    due_at: card.dueAt,
    reps: card.reps,
    lapses: card.lapses,
    fsrs_card_state: card.fsrsCardState,
    fsrs_step_index: card.fsrsStepIndex,
    fsrs_stability: card.fsrsStability,
    fsrs_difficulty: card.fsrsDifficulty,
    fsrs_last_reviewed_at: card.fsrsLastReviewedAt,
    fsrs_scheduled_days: card.fsrsScheduledDays,
  });
  if (invalidReason === null) {
    return card;
  }

  logGuestMergeFsrsStateReset(workspaceId, card.cardId, invalidReason);
  return {
    ...card,
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
  };
}

function createDeckSnapshotInput(
  deck: import("./store").GuestDeckRecord,
): DeckSnapshotInput {
  return {
    deckId: deck.deckId,
    name: deck.name,
    filterDefinition: deck.filterDefinition,
    createdAt: toIsoString(deck.createdAt),
    deletedAt: deck.deletedAt === null ? null : toIsoString(deck.deletedAt),
  };
}

function createReviewEventSnapshot(
  workspaceId: string,
  reviewEvent: import("./store").GuestReviewEventRecord,
  replicaId: string,
): ReviewEvent {
  return {
    reviewEventId: reviewEvent.reviewEventId,
    workspaceId,
    cardId: reviewEvent.cardId,
    replicaId,
    clientEventId: reviewEvent.clientEventId,
    rating: reviewEvent.rating,
    reviewedAtClient: toIsoString(reviewEvent.reviewedAtClient),
    reviewedAtServer: toIsoString(reviewEvent.reviewedAtServer),
  };
}

function createGuestMergeDroppedEntitiesAccumulator(): GuestMergeDroppedEntitiesAccumulator {
  return {
    cardIds: [],
    deckIds: [],
    reviewEventIds: [],
  };
}

function createGuestMergeSourceCleanupInvariantError(
  entityType: SyncConflictEntityType,
  entityId: string,
  sourceGuestWorkspaceId: string,
): Error {
  return new Error(
    `Guest merge cleanup invariant failed for ${entityType} ${entityId}: `
    + `source workspace ${sourceGuestWorkspaceId} still owns the conflicting id after cleanup`,
  );
}

function recordDroppedGuestMergeEntity(
  droppedEntities: GuestMergeDroppedEntitiesAccumulator,
  entityType: SyncConflictEntityType,
  entityId: string,
): void {
  if (entityType === "card") {
    droppedEntities.cardIds.push(entityId);
    return;
  }

  if (entityType === "deck") {
    droppedEntities.deckIds.push(entityId);
    return;
  }

  droppedEntities.reviewEventIds.push(entityId);
}

function finalizeGuestMergeDroppedEntities(
  droppedEntities: GuestMergeDroppedEntitiesAccumulator,
): GuestUpgradeDroppedEntities | undefined {
  if (
    droppedEntities.cardIds.length === 0
    && droppedEntities.deckIds.length === 0
    && droppedEntities.reviewEventIds.length === 0
  ) {
    return undefined;
  }

  return {
    cardIds: droppedEntities.cardIds,
    deckIds: droppedEntities.deckIds,
    reviewEventIds: droppedEntities.reviewEventIds,
  };
}

function createGuestMergeDroppedEntitiesUnsupportedError(
  entityType: SyncConflictEntityType,
  entityId: string,
  conflictingWorkspaceId: string,
): HttpError {
  return new HttpError(
    409,
    `Guest upgrade cannot drop guest ${entityType} ${entityId} because its id conflicts with another workspace and this client did not declare supportsDroppedEntities. Retry /guest-auth/upgrade/complete with supportsDroppedEntities: true.`,
    "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED",
    {
      syncConflict: {
        phase: "guest_upgrade_merge",
        entityType,
        entityId,
        conflictingWorkspaceId,
        constraint: null,
        sqlState: null,
        table: null,
        recoverable: true,
      },
    },
  );
}

function createGuestMergeDroppedReviewEventUnsupportedError(
  reviewEventId: string,
  cardId: string,
): HttpError {
  return new HttpError(
    409,
    `Guest upgrade cannot drop review_event ${reviewEventId} for missing card ${cardId} because this client did not declare supportsDroppedEntities. Retry /guest-auth/upgrade/complete with supportsDroppedEntities: true.`,
    "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED",
  );
}

function createGuestMergeDedupedReviewEventUnsupportedError(
  reviewEventId: string,
  storedReviewEventId: string,
): HttpError {
  return new HttpError(
    409,
    `Guest upgrade cannot drop review_event ${reviewEventId} because the target workspace already has review_event ${storedReviewEventId} for the same client event and this client did not declare supportsDroppedEntities. Retry /guest-auth/upgrade/complete with supportsDroppedEntities: true.`,
    "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED",
  );
}

function resolveGuestMergeThirdWorkspaceConflict(
  error: unknown,
  entityType: SyncConflictEntityType,
  entityId: string,
  sourceGuestWorkspaceId: string,
  targetWorkspaceId: string,
): string | null {
  if (!(error instanceof HttpError) || error.code !== SYNC_WORKSPACE_FORK_REQUIRED) {
    return null;
  }

  const syncConflict = error.details?.syncConflict ?? null;
  if (syncConflict === null) {
    return null;
  }

  const conflictingWorkspaceId = syncConflict?.conflictingWorkspaceId ?? null;
  if (conflictingWorkspaceId === null) {
    return null;
  }

  if (syncConflict.entityType !== entityType || syncConflict.entityId !== entityId) {
    throw new Error(
      `Guest merge conflict metadata mismatch for ${entityType} ${entityId}: `
      + `${syncConflict.entityType} ${syncConflict.entityId}`,
    );
  }

  if (conflictingWorkspaceId === targetWorkspaceId) {
    return null;
  }

  if (conflictingWorkspaceId === sourceGuestWorkspaceId) {
    throw createGuestMergeSourceCleanupInvariantError(
      entityType,
      entityId,
      sourceGuestWorkspaceId,
    );
  }

  return conflictingWorkspaceId;
}

function logGuestMergeDroppedEntity(
  entityType: SyncConflictEntityType,
  entityId: string,
  sourceGuestWorkspaceId: string,
  targetWorkspaceId: string,
  conflictingWorkspaceId: string,
): void {
  console.error(JSON.stringify({
    domain: "guest_auth",
    action: "guest_merge_drop_third_workspace_conflict",
    entityType,
    entityId,
    sourceGuestWorkspaceId,
    targetWorkspaceId,
    conflictingWorkspaceId,
    resolution: "drop_guest_entity",
  }));
}

function logGuestMergeDroppedReviewEventForMissingCard(
  reviewEventId: string,
  cardId: string,
  sourceGuestWorkspaceId: string,
  targetWorkspaceId: string,
): void {
  console.error(JSON.stringify({
    domain: "guest_auth",
    action: "guest_merge_drop_review_event_missing_target_card",
    reviewEventId,
    cardId,
    sourceGuestWorkspaceId,
    targetWorkspaceId,
    resolution: "drop_guest_entity",
  }));
}

async function writeGuestEntityIntoTargetInExecutor(
  input: GuestMergeWriteInput,
): Promise<boolean> {
  try {
    return await input.write();
  } catch (error) {
    const conflictingWorkspaceId = resolveGuestMergeThirdWorkspaceConflict(
      error,
      input.entityType,
      input.entityId,
      input.sourceGuestWorkspaceId,
      input.targetWorkspaceId,
    );
    if (conflictingWorkspaceId === null) {
      throw error;
    }

    if (!input.supportsDroppedEntities) {
      throw createGuestMergeDroppedEntitiesUnsupportedError(
        input.entityType,
        input.entityId,
        conflictingWorkspaceId,
      );
    }

    logGuestMergeDroppedEntity(
      input.entityType,
      input.entityId,
      input.sourceGuestWorkspaceId,
      input.targetWorkspaceId,
      conflictingWorkspaceId,
    );
    return false;
  }
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

async function mergeCardsIntoTargetInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  sourceGuestWorkspaceId: string,
  cards: ReadonlyArray<import("./store").GuestCardRecord>,
  replicaIdMap: ReadonlyMap<string, string>,
  supportsDroppedEntities: boolean,
  droppedEntities: GuestMergeDroppedEntitiesAccumulator,
): Promise<ReadonlySet<string>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  const mergedCardIds = new Set<string>();
  for (const card of cards) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, card.lastModifiedByReplicaId);
    const wasWritten = await writeGuestEntityIntoTargetInExecutor({
      entityType: "card",
      entityId: card.cardId,
      sourceGuestWorkspaceId,
      targetWorkspaceId,
      supportsDroppedEntities,
      write: async (): Promise<boolean> => {
        await upsertCardSnapshotInExecutor(
          executor,
          targetWorkspaceId,
          repairGuestCardSnapshotInput(
            targetWorkspaceId,
            createCardSnapshotInput(card),
          ),
          createGuestMutationMetadata(
            card.clientUpdatedAt,
            targetReplicaId,
            card.lastOperationId,
          ),
        );
        return true;
      },
    });
    if (wasWritten) {
      mergedCardIds.add(card.cardId);
      continue;
    }

    recordDroppedGuestMergeEntity(droppedEntities, "card", card.cardId);
  }

  return mergedCardIds;
}

async function mergeDecksIntoTargetInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  sourceGuestWorkspaceId: string,
  decks: ReadonlyArray<import("./store").GuestDeckRecord>,
  replicaIdMap: ReadonlyMap<string, string>,
  supportsDroppedEntities: boolean,
  droppedEntities: GuestMergeDroppedEntitiesAccumulator,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  for (const deck of decks) {
    const targetReplicaId = requireMappedReplicaId(replicaIdMap, deck.lastModifiedByReplicaId);
    const metadata: DeckMutationMetadata = createGuestMutationMetadata(
      deck.clientUpdatedAt,
      targetReplicaId,
      deck.lastOperationId,
    );
    const wasWritten = await writeGuestEntityIntoTargetInExecutor({
      entityType: "deck",
      entityId: deck.deckId,
      sourceGuestWorkspaceId,
      targetWorkspaceId,
      supportsDroppedEntities,
      write: async (): Promise<boolean> => {
        await upsertDeckSnapshotInExecutor(
          executor,
          targetWorkspaceId,
          createDeckSnapshotInput(deck),
          metadata,
        );
        return true;
      },
    });
    if (!wasWritten) {
      recordDroppedGuestMergeEntity(droppedEntities, "deck", deck.deckId);
    }
  }
}

async function mergeReviewEventsIntoTargetInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  targetWorkspaceId: string,
  sourceGuestWorkspaceId: string,
  reviewEvents: ReadonlyArray<import("./store").GuestReviewEventRecord>,
  replicaIdMap: ReadonlyMap<string, string>,
  mergedCardIds: ReadonlySet<string>,
  supportsDroppedEntities: boolean,
  droppedEntities: GuestMergeDroppedEntitiesAccumulator,
): Promise<void> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: targetUserId,
    workspaceId: targetWorkspaceId,
  });

  for (const reviewEvent of reviewEvents) {
    if (!mergedCardIds.has(reviewEvent.cardId)) {
      if (!supportsDroppedEntities) {
        throw createGuestMergeDroppedReviewEventUnsupportedError(
          reviewEvent.reviewEventId,
          reviewEvent.cardId,
        );
      }

      logGuestMergeDroppedReviewEventForMissingCard(
        reviewEvent.reviewEventId,
        reviewEvent.cardId,
        sourceGuestWorkspaceId,
        targetWorkspaceId,
      );
      recordDroppedGuestMergeEntity(
        droppedEntities,
        "review_event",
        reviewEvent.reviewEventId,
      );
      continue;
    }

    const targetReplicaId = requireMappedReplicaId(replicaIdMap, reviewEvent.replicaId);
    const wasWritten = await writeGuestEntityIntoTargetInExecutor({
      entityType: "review_event",
      entityId: reviewEvent.reviewEventId,
      sourceGuestWorkspaceId,
      targetWorkspaceId,
      supportsDroppedEntities,
      write: async (): Promise<boolean> => {
        const result = await appendReviewEventSnapshotInExecutor(
          executor,
          targetWorkspaceId,
          createReviewEventSnapshot(targetWorkspaceId, reviewEvent, targetReplicaId),
          reviewEvent.reviewEventId,
        );
        if (result.reviewEvent.reviewEventId === reviewEvent.reviewEventId) {
          return true;
        }

        if (!supportsDroppedEntities) {
          throw createGuestMergeDedupedReviewEventUnsupportedError(
            reviewEvent.reviewEventId,
            result.reviewEvent.reviewEventId,
          );
        }

        return false;
      },
    });
    if (!wasWritten) {
      recordDroppedGuestMergeEntity(
        droppedEntities,
        "review_event",
        reviewEvent.reviewEventId,
      );
    }
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
 * Merges already-synced guest cloud workspace state into the selected
 * destination workspace and returns the durable replica alias metadata that
 * must be recorded before the live guest rows are deleted.
 *
 * Cards, decks, and review events keep their existing ids by default. The
 * source content rows are deleted first inside the same transaction to free
 * the global ids, then cards/decks reuse normal snapshot LWW behavior in the
 * target workspace and review events reuse append-only insert-or-no-op
 * behavior. The backend does not create card/deck/review id aliases or consume
 * pending client-local outbox rows. If an impossible global-id conflict still
 * resolves to a true third workspace, the guest entity is dropped only for
 * clients that declared dropped-entity reconciliation support; older clients
 * receive a typed error.
 */
export async function mergeGuestWorkspaceIntoTargetInExecutor(
  executor: DatabaseExecutor,
  params: Readonly<{
    guestSessionId: string;
    sourceGuestSessionSecretHash: string;
    guestUserId: string;
    guestWorkspaceId: string;
    targetSubjectUserId: string;
    targetUserId: string;
    targetWorkspaceId: string;
    selectionType: GuestUpgradeSelectionType;
    supportsDroppedEntities: boolean;
  }>,
): Promise<GuestMergeResult> {
  const upgradeId = randomUUID().toLowerCase();
  const guestReplicas = await loadGuestReplicasInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestCards = await loadGuestCardsInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestDecks = await loadGuestDecksInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestReviewEvents = await loadGuestReviewEventsInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const guestScheduler = await loadWorkspaceSchedulerInExecutor(executor, params.guestUserId, params.guestWorkspaceId);
  const targetScheduler = await loadWorkspaceSchedulerInExecutor(executor, params.targetUserId, params.targetWorkspaceId);
  const droppedEntities = createGuestMergeDroppedEntitiesAccumulator();

  await deleteGuestWorkspaceContentInExecutor(executor, params.guestUserId, params.guestWorkspaceId);

  const replicaIdMap = await recreateGuestReplicasInExecutor(
    executor,
    guestReplicas,
    params.targetUserId,
    params.targetWorkspaceId,
  );

  const mergedCardIds = await mergeCardsIntoTargetInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    params.guestWorkspaceId,
    guestCards,
    replicaIdMap,
    params.supportsDroppedEntities,
    droppedEntities,
  );
  await mergeDecksIntoTargetInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    params.guestWorkspaceId,
    guestDecks,
    replicaIdMap,
    params.supportsDroppedEntities,
    droppedEntities,
  );
  await mergeReviewEventsIntoTargetInExecutor(
    executor,
    params.targetUserId,
    params.targetWorkspaceId,
    params.guestWorkspaceId,
    guestReviewEvents,
    replicaIdMap,
    mergedCardIds,
    params.supportsDroppedEntities,
    droppedEntities,
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

  const finalizedDroppedEntities = finalizeGuestMergeDroppedEntities(droppedEntities);

  return {
    history: {
      upgradeId,
      sourceGuestUserId: params.guestUserId,
      sourceGuestWorkspaceId: params.guestWorkspaceId,
      sourceGuestSessionId: params.guestSessionId,
      sourceGuestSessionSecretHash: params.sourceGuestSessionSecretHash,
      targetSubjectUserId: params.targetSubjectUserId,
      targetUserId: params.targetUserId,
      targetWorkspaceId: params.targetWorkspaceId,
      selectionType: params.selectionType,
      ...(finalizedDroppedEntities === undefined
        ? {}
        : { droppedEntities: finalizedDroppedEntities }),
      replicaIdMap,
    },
  };
}
