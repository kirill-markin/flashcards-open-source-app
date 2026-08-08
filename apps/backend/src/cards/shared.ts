import type { DatabaseExecutor } from "../database";
import { normalizeIsoTimestamp } from "../sync/conflicts/lww";
import { insertSyncChange, type HotChangeWriteLock } from "../sync/replication/changes";
import type {
  Card,
  CardMetadata,
  CardMutationMetadata,
  CardRow,
  CardSourceMetadata,
  DeckSummary,
  DeckSummaryRow,
  ReviewEvent,
  ReviewHistoryItem,
  ReviewHistoryRow,
  TimestampValue,
} from "./types";
import type { LegacyEffortLevel } from "../sync/contracts/legacyEffort";

export const CARD_COLUMNS = [
  "card_id, front_text, back_text, card_type, metadata, tags, effort_level, due_at, created_at, reps, lapses,",
  "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days,",
  "client_updated_at, last_modified_by_replica_id, last_operation_id, updated_at, deleted_at",
].join(" ");

export const REVIEWABLE_CARD_COLUMNS = [
  "card_id, front_text, back_text, due_at, reps, lapses,",
  "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at, fsrs_scheduled_days",
].join(" ");

export const CARD_SELECT = [
  "SELECT",
  CARD_COLUMNS,
  "FROM content.cards",
].join(" ");

export async function loadCardRowForMutation(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<CardRow | undefined> {
  const result = await executor.query<CardRow>(
    [
      CARD_SELECT,
      "WHERE workspace_id = $1 AND card_id = $2",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, cardId],
  );

  return result.rows[0];
}

export function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

export function toDate(value: TimestampValue): Date {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}

export function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

export function normalizeCardMutationMetadata(
  metadata: CardMutationMetadata,
): CardMutationMetadata {
  return {
    clientUpdatedAt: normalizeIsoTimestamp(metadata.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    lastOperationId: metadata.lastOperationId,
  };
}

export function normalizeCardType(cardType: string | undefined): string {
  if (cardType === undefined) {
    return "basic";
  }

  const trimmedCardType = cardType.trim();
  return trimmedCardType === "" ? "basic" : trimmedCardType;
}

function expectCardMetadataRecord(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }

  return value as Readonly<Record<string, unknown>>;
}

function expectNullableCardMetadataString(value: unknown, fieldName: string): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }

  throw new Error(`${fieldName} must be a string or null`);
}

function normalizeCardSourceMetadata(value: unknown): CardSourceMetadata | null {
  if (value === null) {
    return null;
  }

  const record = expectCardMetadataRecord(value, "metadata.source");
  return {
    label: expectNullableCardMetadataString(record.label, "metadata.source.label"),
    author: expectNullableCardMetadataString(record.author, "metadata.source.author"),
    comment: expectNullableCardMetadataString(record.comment, "metadata.source.comment"),
    createdAt: expectNullableCardMetadataString(record.createdAt, "metadata.source.createdAt"),
    importedAt: expectNullableCardMetadataString(record.importedAt, "metadata.source.importedAt"),
    importId: expectNullableCardMetadataString(record.importId, "metadata.source.importId"),
  };
}

export function normalizeCardMetadata(metadata: unknown): CardMetadata {
  const record = expectCardMetadataRecord(metadata, "metadata");
  if (record.version !== 1) {
    throw new Error("metadata.version must be 1");
  }

  return {
    version: 1,
    source: normalizeCardSourceMetadata(record.source),
  };
}

export function createDefaultCardSourceMetadata(createdAt: string): CardSourceMetadata {
  return {
    label: null,
    author: null,
    comment: null,
    createdAt: normalizeIsoTimestamp(createdAt, "metadata.source.createdAt"),
    importedAt: null,
    importId: null,
  };
}

export function createDefaultCardMetadata(createdAt: string): CardMetadata {
  return {
    version: 1,
    source: createDefaultCardSourceMetadata(createdAt),
  };
}

// TODO(old-mobile-cutoff): Remove this legacy effort shim during final sync wire-drop cleanup.
export function appendLegacyEffortTag(
  tags: ReadonlyArray<string>,
  legacyEffortLevel: LegacyEffortLevel | undefined,
): ReadonlyArray<string> {
  const dedupedTags: Array<string> = [];
  const existingTags = new Set<string>();

  for (const tag of tags) {
    if (existingTags.has(tag)) {
      continue;
    }

    existingTags.add(tag);
    dedupedTags.push(tag);
  }

  if (
    legacyEffortLevel !== "medium"
    && legacyEffortLevel !== "long"
  ) {
    return dedupedTags;
  }

  if (!existingTags.has(legacyEffortLevel)) {
    dedupedTags.push(legacyEffortLevel);
  }

  return dedupedTags;
}

export function mapCard(row: CardRow): Card {
  return {
    cardId: row.card_id,
    frontText: row.front_text,
    backText: row.back_text,
    cardType: normalizeCardType(row.card_type),
    metadata: normalizeCardMetadata(row.metadata),
    tags: row.tags,
    dueAt: row.due_at === null ? null : toIsoString(row.due_at),
    createdAt: toIsoString(row.created_at),
    reps: row.reps,
    lapses: row.lapses,
    fsrsCardState: row.fsrs_card_state,
    fsrsStepIndex: row.fsrs_step_index,
    fsrsStability: row.fsrs_stability,
    fsrsDifficulty: row.fsrs_difficulty,
    fsrsLastReviewedAt: row.fsrs_last_reviewed_at === null
      ? null
      : toIsoString(row.fsrs_last_reviewed_at),
    fsrsScheduledDays: row.fsrs_scheduled_days,
    clientUpdatedAt: toIsoString(row.client_updated_at),
    lastModifiedByReplicaId: row.last_modified_by_replica_id,
    lastOperationId: row.last_operation_id,
    updatedAt: toIsoString(row.updated_at),
    deletedAt: row.deleted_at === null ? null : toIsoString(row.deleted_at),
  };
}

export function mapReviewHistoryItem(row: ReviewHistoryRow): ReviewHistoryItem {
  return {
    reviewEventId: row.review_event_id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    replicaId: row.replica_id,
    clientEventId: row.client_event_id,
    rating: row.rating,
    reviewedAtClient: toIsoString(row.reviewed_at_client),
    reviewedAtServer: toIsoString(row.reviewed_at_server),
    reviewedTimeZone: row.reviewed_time_zone ?? undefined,
  };
}

export function toCardLwwMetadata(card: Card): CardMutationMetadata {
  return {
    clientUpdatedAt: card.clientUpdatedAt,
    lastModifiedByReplicaId: card.lastModifiedByReplicaId,
    lastOperationId: card.lastOperationId,
  };
}

export async function recordCardSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  card: Card,
): Promise<number> {
  return insertSyncChange(
    executor,
    workspaceId,
    hotChangeWriteLock,
    "card",
    card.cardId,
    "upsert",
    card.lastModifiedByReplicaId,
    card.lastOperationId,
    card.clientUpdatedAt,
  );
}

export function mapDeckSummary(row: DeckSummaryRow): DeckSummary {
  return {
    totalCards: toNumber(row.total_cards),
    dueCards: toNumber(row.due_cards),
    newCards: toNumber(row.new_cards),
    reviewedCards: toNumber(row.reviewed_cards),
    totalReps: toNumber(row.total_reps),
    totalLapses: toNumber(row.total_lapses),
  };
}
