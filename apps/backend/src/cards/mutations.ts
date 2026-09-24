import { randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../database";
import {
  collectContentAuthoringUpdate,
  collectContentCreation,
  collectContentDeletion,
  transactionWithWorkspaceScopeReportingContentWrites,
} from "../productAnalytics/serverFacts/contentWrites";
import { HttpError } from "../shared/errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
} from "../sync/conflicts/lww";
import {
  findLatestSyncChangeId,
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
} from "../sync/replication/changes";
import {
  createSyncConflictHttpError,
  findSyncConflictWorkspaceIdInExecutor,
} from "../sync/conflicts/fork";
import {
  mergeManagedImageReferencesIntoCardSnapshot,
  type ManagedImageRestoreLedger,
} from "./managedMedia/managedImageSnapshotMerge";
import { assertConsistentFsrsState } from "./review/fsrs";
import {
  authoredTagsChanged,
  CARD_COLUMNS,
  createDefaultCardMetadata,
  loadCardRowForMutation,
  mapCard,
  normalizeCardMetadata,
  normalizeCardMutationMetadata,
  normalizeCardType,
  recordCardSyncChange,
  toCardLwwMetadata,
} from "./shared";
import type {
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkDeleteCardsResult,
  BulkUpdateCardItem,
  Card,
  CardMutationMetadata,
  CardMutationResult,
  CardRow,
  CardSnapshotInput,
  CreateCardInput,
  UpdateCardInput,
  UpdateQueryParts,
} from "./types";

const MAX_CARD_BATCH_SIZE = 100;

// What updateCardInExecutor's statement returns: the written row, plus the authored fields the row
// held before the write, captured by the same statement.
type UpdatedCardRow = CardRow & Readonly<{
  previous_front_text: string;
  previous_back_text: string;
  previous_tags: ReadonlyArray<string>;
}>;

// The three card fields a person authors, and the only ones `card_updated` is measured on. Every
// other column content.cards carries is scheduling state (due_at and the FSRS columns), provenance
// bookkeeping (metadata), the card's shape (card_type), or sync bookkeeping, so a review, a
// progress reset, a settled managed image and a re-sync that moves only those is not an edit.
type CardAuthoredFields = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

/**
 * Whether a write changed what a person authored on a card.
 *
 * Both sides must be values the database held or returned, never a request body: an offline-first
 * client re-sends every field of a card on every push, so "the request named this field" carries no
 * information about whether anything changed.
 *
 * Tags are compared by ./shared.ts, which owns that rule for cards and decks alike.
 */
function cardAuthoringFieldsChanged(before: CardAuthoredFields, after: CardAuthoredFields): boolean {
  if (before.frontText !== after.frontText || before.backText !== after.backText) {
    return true;
  }

  return authoredTagsChanged(before.tags, after.tags);
}

function normalizeRequiredCardText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeOptionalCardText(value: string): string {
  return value.trim();
}

function dedupeCardTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  const dedupedTags: Array<string> = [];
  const existingTags = new Set<string>();

  for (const tag of tags) {
    if (existingTags.has(tag)) {
      continue;
    }

    existingTags.add(tag);
    dedupedTags.push(tag);
  }

  return dedupedTags;
}

function normalizeCreateCardInput(input: CreateCardInput): CreateCardInput {
  return {
    frontText: normalizeRequiredCardText(input.frontText, "frontText"),
    backText: normalizeOptionalCardText(input.backText),
    cardType: input.cardType === undefined ? undefined : normalizeCardType(input.cardType),
    metadata: input.metadata === undefined ? undefined : normalizeCardMetadata(input.metadata),
    tags: dedupeCardTags(input.tags),
  };
}

function normalizeUpdateCardInput(input: UpdateCardInput): UpdateCardInput {
  return {
    frontText: input.frontText === undefined
      ? undefined
      : normalizeRequiredCardText(input.frontText, "frontText"),
    backText: input.backText === undefined ? undefined : normalizeOptionalCardText(input.backText),
    cardType: input.cardType === undefined ? undefined : normalizeCardType(input.cardType),
    metadata: input.metadata === undefined ? undefined : normalizeCardMetadata(input.metadata),
    tags: input.tags === undefined ? undefined : dedupeCardTags(input.tags),
  };
}

function buildCardUpdateQueryParts(input: UpdateCardInput): UpdateQueryParts {
  const assignments: Array<string> = [];
  const params: Array<string | ReadonlyArray<string>> = [];

  if (input.frontText !== undefined) {
    assignments.push(`front_text = $${assignments.length + 1}`);
    params.push(input.frontText);
  }

  if (input.backText !== undefined) {
    assignments.push(`back_text = $${assignments.length + 1}`);
    params.push(input.backText);
  }

  if (input.cardType !== undefined) {
    assignments.push(`card_type = $${assignments.length + 1}`);
    params.push(input.cardType);
  }

  if (input.metadata !== undefined) {
    assignments.push(`metadata = $${assignments.length + 1}::jsonb`);
    params.push(JSON.stringify(input.metadata));
  }

  if (input.tags !== undefined) {
    assignments.push(`tags = $${assignments.length + 1}`);
    params.push(input.tags);
  }

  return { assignments, params };
}

function validateCardBatchCount(count: number): void {
  if (count < 1) {
    throw new HttpError(400, "Card batch must contain at least one item");
  }

  if (count > MAX_CARD_BATCH_SIZE) {
    throw new HttpError(400, `Card batch must contain at most ${MAX_CARD_BATCH_SIZE} items`);
  }
}

function validateUniqueCardIds(cardIds: ReadonlyArray<string>): void {
  const uniqueCardIds = new Set(cardIds);
  if (uniqueCardIds.size !== cardIds.length) {
    throw new HttpError(400, "Card batch must not contain duplicate cardId values");
  }
}

function normalizeCardSnapshotInput(input: CardSnapshotInput): CardSnapshotInput {
  const normalizedSnapshot: CardSnapshotInput = {
    cardId: input.cardId,
    frontText: normalizeRequiredCardText(input.frontText, "frontText"),
    backText: normalizeOptionalCardText(input.backText),
    ...(input.cardType === undefined ? {} : { cardType: normalizeCardType(input.cardType) }),
    ...(input.metadata === undefined ? {} : { metadata: normalizeCardMetadata(input.metadata) }),
    tags: dedupeCardTags(input.tags),
    dueAt: input.dueAt === null ? null : normalizeIsoTimestamp(input.dueAt, "dueAt"),
    createdAt: normalizeIsoTimestamp(input.createdAt, "createdAt"),
    reps: input.reps,
    lapses: input.lapses,
    fsrsCardState: input.fsrsCardState,
    fsrsStepIndex: input.fsrsStepIndex,
    fsrsStability: input.fsrsStability,
    fsrsDifficulty: input.fsrsDifficulty,
    fsrsLastReviewedAt: input.fsrsLastReviewedAt === null
      ? null
      : normalizeIsoTimestamp(input.fsrsLastReviewedAt, "fsrsLastReviewedAt"),
    fsrsScheduledDays: input.fsrsScheduledDays,
    deletedAt: input.deletedAt === null ? null : normalizeIsoTimestamp(input.deletedAt, "deletedAt"),
  };

  assertConsistentFsrsState({
    due_at: normalizedSnapshot.dueAt,
    reps: normalizedSnapshot.reps,
    lapses: normalizedSnapshot.lapses,
    fsrs_card_state: normalizedSnapshot.fsrsCardState,
    fsrs_step_index: normalizedSnapshot.fsrsStepIndex,
    fsrs_stability: normalizedSnapshot.fsrsStability,
    fsrs_difficulty: normalizedSnapshot.fsrsDifficulty,
    fsrs_last_reviewed_at: normalizedSnapshot.fsrsLastReviewedAt,
    fsrs_scheduled_days: normalizedSnapshot.fsrsScheduledDays,
  });

  return normalizedSnapshot;
}

async function insertCardRowForSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CardSnapshotInput,
  metadata: CardMutationMetadata,
): Promise<CardRow | null> {
  const cardType = input.cardType ?? "basic";
  const cardMetadata = input.metadata ?? createDefaultCardMetadata(input.createdAt);
  const result = await executor.query<CardRow>(
    [
      "INSERT INTO content.cards",
      "(",
      "card_id, workspace_id, front_text, back_text, card_type, metadata, tags, effort_level, due_at, created_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id, deleted_at",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'fast', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)",
      "ON CONFLICT DO NOTHING",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      input.cardId,
      workspaceId,
      input.frontText,
      input.backText,
      cardType,
      JSON.stringify(cardMetadata),
      input.tags,
      input.dueAt,
      input.createdAt,
      input.reps,
      input.lapses,
      input.fsrsCardState,
      input.fsrsStepIndex,
      input.fsrsStability,
      input.fsrsDifficulty,
      input.fsrsLastReviewedAt,
      input.fsrsScheduledDays,
      metadata.clientUpdatedAt,
      metadata.lastModifiedByReplicaId,
      metadata.lastOperationId,
      input.deletedAt,
    ],
  );

  return result.rows[0] ?? null;
}

async function resolveCardSnapshotInsertConflictInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<CardRow> {
  const conflictingWorkspaceId = await findSyncConflictWorkspaceIdInExecutor(executor, {
    entityType: "card",
    entityId: cardId,
  });

  if (conflictingWorkspaceId === null) {
    throw new Error(`Card insert was skipped but no conflicting workspace was found for ${cardId}`);
  }

  if (conflictingWorkspaceId !== workspaceId) {
    throw createSyncConflictHttpError({
      phase: "sync_write",
      entityType: "card",
      entityId: cardId,
      conflictingWorkspaceId,
      constraint: "cards_pkey",
      sqlState: "23505",
      table: "cards",
    });
  }

  const existingRow = await loadCardRowForMutation(executor, workspaceId, cardId);
  if (existingRow === undefined) {
    throw new Error(`Card insert was skipped but the current workspace row was not found for ${cardId}`);
  }

  return existingRow;
}

/**
 * Per-request state a snapshot upsert needs and cannot derive from its own arguments.
 *
 * Only the sync push supplies one, because it is the only caller that can write the same card twice
 * in one request: the bootstrap push refuses a workspace that already holds anything, and the guest
 * merge walks each card once.
 */
export type CardSnapshotUpsertOptions = Readonly<{
  managedImageRestoreLedger?: ManagedImageRestoreLedger;
}>;

export async function upsertCardSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CardSnapshotInput,
  metadata: CardMutationMetadata,
  options?: CardSnapshotUpsertOptions,
): Promise<CardMutationResult> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
  const normalizedInput = normalizeCardSnapshotInput(input);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  let existingRow = await loadCardRowForMutation(executor, workspaceId, normalizedInput.cardId);

  if (existingRow === undefined) {
    const insertedRow = await insertCardRowForSnapshotInExecutor(
      executor,
      workspaceId,
      normalizedInput,
      normalizedMetadata,
    );

    if (insertedRow === null) {
      existingRow = await resolveCardSnapshotInsertConflictInExecutor(
        executor,
        workspaceId,
        normalizedInput.cardId,
      );
    } else {
      const insertedCard = mapCard(insertedRow);
      const changeId = await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, insertedCard);
      // The insert above is ON CONFLICT DO NOTHING, so a returned row is a genuine creation. The
      // conflict branch below is the one that turns out to be an upsert of a card that already
      // existed, and the LWW-lost branch after it writes nothing at all.
      collectContentCreation(executor, {
        entityType: "card",
        entityId: insertedCard.cardId,
        workspaceId,
        replicaId: insertedCard.lastModifiedByReplicaId,
        clientUpdatedAt: insertedCard.clientUpdatedAt,
      });
      // A first sync that already carries a tombstone: the person created the card and deleted it
      // before it ever reached the server, which sees only the end state. Both facts are true, so
      // both are collected here - the transition branch below cannot also fire in this call, and
      // reporting the creation alone would leave card_created minus card_deleted overstating the
      // live library by exactly the cards that were never synced alive.
      if (insertedCard.deletedAt !== null) {
        collectContentDeletion(executor, {
          entityType: "card",
          entityId: insertedCard.cardId,
          workspaceId,
          replicaId: insertedCard.lastModifiedByReplicaId,
          clientUpdatedAt: insertedCard.clientUpdatedAt,
        });
      }

      return {
        card: insertedCard,
        applied: true,
        changeId,
      };
    }
  }

  const existingCard = mapCard(existingRow);
  if (incomingLwwMetadataWins(normalizedMetadata, toCardLwwMetadata(existingCard)) === false) {
    return {
      card: existingCard,
      applied: false,
      changeId: await findLatestSyncChangeId(executor, workspaceId, "card", existingCard.cardId),
    };
  }

  // The snapshot wins last-write-wins, and that is not the same as the device knowing what it is
  // overwriting. A managed image the backend wrote into this card's text would be erased here by a
  // device that never pulled it, so those references are put back into the text about to be stored.
  // ./managedMedia/managedImageSnapshotMerge.ts owns the rule and the reasoning, including what it
  // does when the person removed the image on purpose, and how it settles a reference the snapshot
  // still carries in a lifecycle state the server has already moved past.
  //
  // It returns the `client_updated_at` to store as well, and that is not cosmetic: a restore has to
  // outrank the row the pushing device still holds, or iOS skips its own merged card on the next
  // pull and the reference dies on the push after this one. The merge returns the client's own
  // stamp untouched whenever it changed nothing.
  const mergedCardWrite = mergeManagedImageReferencesIntoCardSnapshot(
    existingRow,
    {
      frontText: normalizedInput.frontText,
      backText: normalizedInput.backText,
      clientUpdatedAt: normalizedMetadata.clientUpdatedAt,
    },
    normalizedMetadata.lastModifiedByReplicaId,
    options?.managedImageRestoreLedger,
  );

  const updateResult = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET front_text = $1, back_text = $2, card_type = $3, metadata = $4::jsonb, tags = $5, effort_level = 'fast', due_at = $6, reps = $7, lapses = $8,",
      "fsrs_card_state = $9, fsrs_step_index = $10, fsrs_stability = $11, fsrs_difficulty = $12,",
      "fsrs_last_reviewed_at = $13, fsrs_scheduled_days = $14, deleted_at = $15, client_updated_at = $16,",
      "last_modified_by_replica_id = $17, last_operation_id = $18, updated_at = now()",
      "WHERE workspace_id = $19 AND card_id = $20",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      mergedCardWrite.frontText,
      mergedCardWrite.backText,
      normalizedInput.cardType ?? existingCard.cardType,
      JSON.stringify(normalizedInput.metadata ?? existingCard.metadata),
      normalizedInput.tags,
      normalizedInput.dueAt,
      normalizedInput.reps,
      normalizedInput.lapses,
      normalizedInput.fsrsCardState,
      normalizedInput.fsrsStepIndex,
      normalizedInput.fsrsStability,
      normalizedInput.fsrsDifficulty,
      normalizedInput.fsrsLastReviewedAt,
      normalizedInput.fsrsScheduledDays,
      normalizedInput.deletedAt,
      mergedCardWrite.clientUpdatedAt,
      normalizedMetadata.lastModifiedByReplicaId,
      normalizedMetadata.lastOperationId,
      workspaceId,
      normalizedInput.cardId,
    ],
  );

  const updatedRow = updateResult.rows[0];
  if (updatedRow === undefined) {
    throw new Error("Card update did not return a row");
  }

  const updatedCard = mapCard(updatedRow);
  const changeId = await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, updatedCard);
  // The snapshot that turned a live card into a tombstone, which is how a deletion a person made
  // offline reaches the server. Only the transition counts: a snapshot re-sending a tombstone the
  // server already holds leaves existingCard deleted and reports nothing, so a client re-syncing
  // its whole library cannot count one deletion again.
  if (existingCard.deletedAt === null && updatedCard.deletedAt !== null) {
    collectContentDeletion(executor, {
      entityType: "card",
      entityId: updatedCard.cardId,
      workspaceId,
      replicaId: updatedCard.lastModifiedByReplicaId,
      clientUpdatedAt: updatedCard.clientUpdatedAt,
    });
  }

  // The authoring edit, and the only place a client's own card edits are counted at all: all three
  // clients are offline-first and push their edits as snapshots through this function rather than
  // through any card-update route.
  //
  // Both sides of the comparison are rows the database returned, which is what makes it an edit
  // test rather than a write test. A push carrying a review's new scheduling, a progress reset
  // syncing back, or a settled managed image the device pulled and re-sent leaves the authored
  // fields identical and reports nothing.
  //
  // That holds for the text the pushing device was holding, not for the text the server was
  // holding, and the two are the same only while the device is caught up. A client freezes the
  // whole snapshot into its outbox when it queues the write, so a device that has not pulled a
  // newer text sends the stale text in the next snapshot it pushes for any reason at all, and
  // pulling before pushing cannot refresh an already-queued payload. That snapshot is stamped with
  // the moment of the action that queued it, so it wins last-write-wins, reverts the stored text a
  // few lines above, and is collected here as an edit - correctly by this function's definition,
  // and attributed to a review rather than to a person.
  //
  // The newer text it reverts most often came from another of the person's own devices, and no
  // server-side writer is needed for any of it: phone edits, laptop is behind, laptop reviews and
  // pushes. Backend managed-image append and settlement opens the same window from the server side
  // (./managedMedia/managedImageSettlement.ts) and is one instance of the mechanism rather than its
  // cause - and the one instance this no longer counts, because the merge a few lines above puts
  // those references back, so a stale push whose only difference from the stored text was the
  // missing reference now reproduces that text and reports nothing. Only that case: the restore
  // appends a trailing block, so once anything was written after the image on that side the merged
  // text matches neither side, one row is stored, and it is the ordinary over-count again.
  // ../productAnalytics/catalog.ts discloses all of it to readers of the table.
  //
  // `updatedCard.deletedAt === null` is what keeps deletion and authoring apart. A write that
  // tombstoned the card is the deletion collected just above and nothing else, even if it also
  // carried different text, and a write over a card the server already held tombstoned is not
  // authoring. The one write that passes this guard having found a tombstone is a card coming back
  // alive with different text, which is a real edit and is counted: the row is live again and
  // carries text a person wrote. `card_deleted` is keyed on the card alone and so does not count
  // that card's second deletion, which is why the two series can show an edit after a deletion for
  // one card.
  if (updatedCard.deletedAt === null && cardAuthoringFieldsChanged(existingCard, updatedCard)) {
    collectContentAuthoringUpdate(executor, {
      entityType: "card",
      entityId: updatedCard.cardId,
      workspaceId,
      replicaId: updatedCard.lastModifiedByReplicaId,
      clientUpdatedAt: updatedCard.clientUpdatedAt,
      operationId: updatedCard.lastOperationId,
    });
  }

  return {
    card: updatedCard,
    applied: true,
    changeId,
  };
}

export async function upsertCardSnapshot(
  userId: string,
  workspaceId: string,
  input: CardSnapshotInput,
  metadata: CardMutationMetadata,
): Promise<CardMutationResult> {
  return transactionWithWorkspaceScopeReportingContentWrites({ userId, workspaceId }, async (executor) => (
    upsertCardSnapshotInExecutor(executor, workspaceId, input, metadata)
  ));
}

export async function createCardInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CreateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
  const normalizedInput = normalizeCreateCardInput(input);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);
  const createdAt = normalizeIsoTimestamp(normalizedMetadata.clientUpdatedAt, "clientUpdatedAt");

  const result = await executor.query<CardRow>(
    [
      "INSERT INTO content.cards",
      "(",
      "card_id, workspace_id, front_text, back_text, card_type, metadata, tags, effort_level, due_at, created_at,",
      "reps, lapses, fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
      "client_updated_at, last_modified_by_replica_id, last_operation_id",
      ")",
      "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'fast', NULL, $8, 0, 0, 'new', NULL, NULL, NULL, NULL, NULL, $9, $10, $11)",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      randomUUID(),
      workspaceId,
      normalizedInput.frontText,
      normalizedInput.backText,
      normalizedInput.cardType ?? "basic",
      JSON.stringify(normalizedInput.metadata ?? createDefaultCardMetadata(createdAt)),
      normalizedInput.tags,
      createdAt,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByReplicaId,
      normalizedMetadata.lastOperationId,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Card insert did not return a row");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, card);
  // This path inserts unconditionally on a freshly minted card id, so it is always a creation.
  collectContentCreation(executor, {
    entityType: "card",
    entityId: card.cardId,
    workspaceId,
    replicaId: card.lastModifiedByReplicaId,
    clientUpdatedAt: card.clientUpdatedAt,
  });
  return card;
}

export async function createCard(
  userId: string,
  workspaceId: string,
  input: CreateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transactionWithWorkspaceScopeReportingContentWrites(
    { userId, workspaceId },
    async (executor) => createCardInExecutor(executor, workspaceId, input, metadata),
  );
}

export async function createCards(
  userId: string,
  workspaceId: string,
  items: ReadonlyArray<BulkCreateCardItem>,
): Promise<ReadonlyArray<Card>> {
  validateCardBatchCount(items.length);

  return transactionWithWorkspaceScopeReportingContentWrites({ userId, workspaceId }, async (executor) => {
    const createdCards: Array<Card> = [];
    for (const item of items) {
      createdCards.push(await createCardInExecutor(executor, workspaceId, item.input, item.metadata));
    }

    return createdCards;
  });
}

export async function updateCardInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
  const normalizedInput = normalizeUpdateCardInput(input);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  const updateParts = buildCardUpdateQueryParts(normalizedInput);

  if (updateParts.assignments.length === 0) {
    throw new HttpError(400, "At least one editable field must be provided");
  }

  const params = [
    ...updateParts.params,
    normalizedMetadata.clientUpdatedAt,
    normalizedMetadata.lastModifiedByReplicaId,
    normalizedMetadata.lastOperationId,
    workspaceId,
    cardId,
  ];

  const workspaceIdParam = `$${params.length - 1}`;
  const cardIdParam = `$${params.length}`;
  const result = await executor.query<UpdatedCardRow>(
    [
      // The authored fields as the row held them before this write, captured by the same statement
      // that does the write rather than by a second read of the row. That is the whole reason for
      // the CTE: this path serves the agent surfaces, where one SQL batch can update a hundred
      // cards, and a preceding SELECT per card would be a hundred extra round trips to answer an
      // analytics question.
      //
      // The CTE reads the row under the statement's own snapshot, so it is genuinely the previous
      // version and not the one this UPDATE leaves. It cannot go stale under a concurrent writer
      // either: every path that UPDATEs a row of content.cards first takes
      // sync.workspace_sync_metadata FOR UPDATE for the workspace
      // (lockWorkspaceSyncMetadataForHotChangesInExecutor, called above), so those writers are
      // serialized per workspace and none of them can change this row between the CTE and the
      // UPDATE. Exactly one writer stands outside that lock and it cannot make this read wrong:
      // guest-workspace teardown (../guestAuth/store/deletion.ts) DELETEs the workspace's cards
      // wholesale under the workspace access-lifecycle lock instead, and a row it removed makes
      // this UPDATE match nothing, which is the 404 below rather than a stale previous value.
      //
      // Every selected column is aliased, which is what keeps CARD_COLUMNS usable unqualified in
      // RETURNING: front_text, back_text, tags and card_id would otherwise be ambiguous across the
      // join.
      "WITH previous AS (",
      "SELECT card_id AS previous_card_id, front_text AS previous_front_text,",
      "back_text AS previous_back_text, tags AS previous_tags",
      "FROM content.cards",
      `WHERE workspace_id = ${workspaceIdParam} AND card_id = ${cardIdParam} AND deleted_at IS NULL`,
      ")",
      "UPDATE content.cards",
      `SET ${updateParts.assignments.join(", ")}, client_updated_at = $${params.length - 4},`,
      `last_modified_by_replica_id = $${params.length - 3}, last_operation_id = $${params.length - 2}, updated_at = now()`,
      "FROM previous",
      `WHERE workspace_id = ${workspaceIdParam} AND card_id = ${cardIdParam} AND deleted_at IS NULL`,
      "AND card_id = previous.previous_card_id",
      "RETURNING",
      `${CARD_COLUMNS},`,
      "previous.previous_front_text, previous.previous_back_text, previous.previous_tags",
    ].join(" "),
    params,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, card);
  // The authoring edit for the agent surfaces, which are the only callers of this path: the sync
  // push and the sync bootstrap push write through upsertCardSnapshotInExecutor instead and collect
  // their own. The statement matches on deleted_at IS NULL and 404s otherwise, so a card reached
  // here was alive before the write and is alive after it, and neither the deletion nor the
  // tombstone-edit case the snapshot path has to rule out can occur.
  if (cardAuthoringFieldsChanged(
    {
      frontText: row.previous_front_text,
      backText: row.previous_back_text,
      tags: row.previous_tags,
    },
    card,
  )) {
    collectContentAuthoringUpdate(executor, {
      entityType: "card",
      entityId: card.cardId,
      workspaceId,
      replicaId: card.lastModifiedByReplicaId,
      clientUpdatedAt: card.clientUpdatedAt,
      operationId: card.lastOperationId,
    });
  }

  return card;
}

// The card update transactions below are on the reporting wrapper, like the delete transactions
// further down: updateCardInExecutor collects an authoring edit when a write changed a card's
// authored fields, and that collection is dropped unless the wrapper's post-commit drain emits it.
// Neither of them can reach the snapshot upsert's insert branch, so neither ever reports a creation.
export async function updateCard(
  userId: string,
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transactionWithWorkspaceScopeReportingContentWrites(
    { userId, workspaceId },
    async (executor) => updateCardInExecutor(executor, workspaceId, cardId, input, metadata),
  );
}

export async function updateCards(
  userId: string,
  workspaceId: string,
  items: ReadonlyArray<BulkUpdateCardItem>,
): Promise<ReadonlyArray<Card>> {
  validateCardBatchCount(items.length);
  validateUniqueCardIds(items.map((item) => item.cardId));

  return transactionWithWorkspaceScopeReportingContentWrites({ userId, workspaceId }, async (executor) => {
    const updatedCards: Array<Card> = [];
    for (const item of items) {
      updatedCards.push(
        await updateCardInExecutor(executor, workspaceId, item.cardId, item.input, item.metadata),
      );
    }

    return updatedCards;
  });
}

export async function deleteCardInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  metadata: CardMutationMetadata,
): Promise<Card> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET deleted_at = $1, client_updated_at = $2, last_modified_by_replica_id = $3, last_operation_id = $4, updated_at = now()",
      "WHERE workspace_id = $5 AND card_id = $6 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.clientUpdatedAt,
      normalizedMetadata.lastModifiedByReplicaId,
      normalizedMetadata.lastOperationId,
      workspaceId,
      cardId,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, card);
  // The update above matches on deleted_at IS NULL, so a returned row is a card this statement
  // found alive and left tombstoned. A card already gone returns nothing and raises the 404 above
  // instead of reaching here, which is what keeps a repeated delete from counting twice.
  collectContentDeletion(executor, {
    entityType: "card",
    entityId: card.cardId,
    workspaceId,
    replicaId: card.lastModifiedByReplicaId,
    clientUpdatedAt: card.clientUpdatedAt,
  });
  return card;
}

export async function deleteCard(
  userId: string,
  workspaceId: string,
  cardId: string,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transactionWithWorkspaceScopeReportingContentWrites(
    { userId, workspaceId },
    async (executor) => deleteCardInExecutor(executor, workspaceId, cardId, metadata),
  );
}

export async function deleteCards(
  userId: string,
  workspaceId: string,
  items: ReadonlyArray<BulkDeleteCardItem>,
): Promise<BulkDeleteCardsResult> {
  validateCardBatchCount(items.length);
  validateUniqueCardIds(items.map((item) => item.cardId));

  return transactionWithWorkspaceScopeReportingContentWrites({ userId, workspaceId }, async (executor) => {
    const deletedCardIds: Array<string> = [];
    for (const item of items) {
      const deletedCard = await deleteCardInExecutor(executor, workspaceId, item.cardId, item.metadata);
      deletedCardIds.push(deletedCard.cardId);
    }

    return {
      deletedCardIds,
      deletedCount: deletedCardIds.length,
    };
  });
}
