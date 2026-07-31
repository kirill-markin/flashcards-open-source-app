import { randomUUID } from "node:crypto";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../database";
import { expectUuidString } from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import {
  incomingLwwMetadataWins,
  normalizeIsoTimestamp,
} from "../sync/conflicts/lww";
import {
  findLatestSyncChangeId,
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
  type HotChangeWriteLock,
} from "../sync/replication/changes";
import {
  extractMarkdownImageDestinationUrls,
  isMarkdownComplexityLimitError,
  rewriteMarkdownImageDestinationUrl,
} from "../workspacePackages/markdownMedia";
import {
  createSyncConflictHttpError,
  findSyncConflictWorkspaceIdInExecutor,
} from "../sync/conflicts/fork";
import { assertConsistentFsrsState } from "./fsrs";
import {
  CARD_COLUMNS,
  CARD_SELECT,
  createDefaultCardMetadata,
  mapCard,
  normalizeCardMetadata,
  normalizeCardMutationMetadata,
  normalizeCardType,
  recordCardSyncChange,
  toCardLwwMetadata,
} from "./shared";
import type {
  AppendManagedImageToCardSideInput,
  AppendManagedImageToCardSideResult,
  AppendPendingManagedImageToCardSideResult,
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkDeleteCardsResult,
  BulkUpdateCardItem,
  Card,
  CardMutationMetadata,
  CardMutationResult,
  CardRow,
  CardSnapshotInput,
  CardTextSide,
  CreateCardInput,
  UpdateCardInput,
  UpdateQueryParts,
} from "./types";

const MAX_CARD_BATCH_SIZE = 100;

type AppendedManagedImageCardText = Readonly<{ text: string; applied: boolean }>;

const pendingManagedImageSettlementConflictCode =
  "GENERATED_IMAGE_PENDING_MARKER_CONFLICT";
export const managedImageMarkdownComplexitySettlementConflictCode =
  "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT";

export class PendingManagedImageSettlementConflictError extends HttpError {
  readonly conflictCode = pendingManagedImageSettlementConflictCode;
  readonly pendingMarkerCount: number;

  constructor(targetSide: CardTextSide, pendingMarkerCount: number) {
    super(
      409,
      `Generated image settlement requires exactly one pending marker on the ${targetSide} side; found ${pendingMarkerCount}. Card text was preserved.`,
      pendingManagedImageSettlementConflictCode,
    );
    this.pendingMarkerCount = pendingMarkerCount;
  }
}

export class ManagedImageMarkdownComplexitySettlementConflictError extends HttpError {
  readonly conflictCode =
    managedImageMarkdownComplexitySettlementConflictCode;

  constructor(targetSide: CardTextSide) {
    super(
      409,
      `Generated image settlement could not inspect the ${targetSide} side because its Markdown exceeds parser complexity limits. Card text was preserved.`,
      managedImageMarkdownComplexitySettlementConflictCode,
    );
  }
}

export type ManagedImageSettlementConflictError =
  PendingManagedImageSettlementConflictError
  | ManagedImageMarkdownComplexitySettlementConflictError;

export function isManagedImageSettlementConflictError(
  error: unknown,
): error is ManagedImageSettlementConflictError {
  return error instanceof PendingManagedImageSettlementConflictError
    || error instanceof ManagedImageMarkdownComplexitySettlementConflictError;
}

function translateManagedImageSettlementParserError(
  error: unknown,
  targetSide: CardTextSide,
): never {
  if (isMarkdownComplexityLimitError(error)) {
    throw new ManagedImageMarkdownComplexitySettlementConflictError(targetSide);
  }
  throw error;
}

const cardTextColumnBySide: Readonly<Record<CardTextSide, "front_text" | "back_text">> = {
  front: "front_text",
  back: "back_text",
};

function normalizeCardTextSide(targetSide: CardTextSide): CardTextSide {
  if (targetSide !== "front" && targetSide !== "back") {
    throw new HttpError(400, "targetSide must be either front or back");
  }

  return targetSide;
}

function normalizeManagedImageAltText(altText: string): string {
  const normalizedAltText = altText
    .trim()
    .replace(/\r\n|\r|\n/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\\/gu, "＼")
    .replace(/\[/gu, "(")
    .replace(/\]/gu, ")");
  if (normalizedAltText === "") {
    throw new HttpError(400, "altText must not be empty");
  }

  return normalizedAltText;
}

function buildNormalizedManagedImageMarkdownReference(mediaAssetId: string, altText: string): string {
  return `![${altText}](fcasset:${mediaAssetId})`;
}

function buildPendingManagedImageMarkdownReference(mediaAssetId: string, altText: string): string {
  return `![${altText}](fcasset:${mediaAssetId}?state=pending)`;
}

function buildReadyManagedImageUrl(mediaAssetId: string): string {
  return `fcasset:${mediaAssetId}`;
}

function buildPendingManagedImageUrl(mediaAssetId: string): string {
  return `fcasset:${mediaAssetId}?state=pending`;
}

function buildFailedManagedImageUrl(mediaAssetId: string): string {
  return `fcasset:${mediaAssetId}?state=failed`;
}

function managedImageUrlReferencesMediaAsset(url: string, mediaAssetId: string): boolean {
  const normalizedUrl = url.toLowerCase();
  const normalizedPrefix = `fcasset:${mediaAssetId}`;
  return normalizedUrl === normalizedPrefix
    || normalizedUrl.startsWith(`${normalizedPrefix}?`)
    || normalizedUrl.startsWith(`${normalizedPrefix}#`);
}

function hasManagedImageMarkdownReference(text: string, mediaAssetId: string): boolean {
  return extractMarkdownImageDestinationUrls(text)
    .some((url) => managedImageUrlReferencesMediaAsset(url, mediaAssetId));
}

function hasExactManagedImageUrl(text: string, url: string): boolean {
  return extractMarkdownImageDestinationUrls(text).some((candidate) => candidate === url);
}

function appendMarkdownBlock(text: string, markdownBlock: string): string {
  const separator = text === "" || text.endsWith("\n\n")
    ? ""
    : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${markdownBlock}`;
}

function appendNormalizedManagedImageToCardText(
  text: string,
  mediaAssetId: string,
  markdownReference: string,
  expectedUrl: string,
): AppendedManagedImageCardText {
  if (hasManagedImageMarkdownReference(text, mediaAssetId)) {
    return { text, applied: false };
  }

  const appendedText = appendMarkdownBlock(text, markdownReference);
  if (!hasExactManagedImageUrl(appendedText, expectedUrl)) {
    throw new HttpError(
      409,
      "Close the selected card side's unterminated Markdown fence or HTML block before appending an image.",
      "CARD_IMAGE_APPEND_MARKDOWN_BLOCK_UNCLOSED",
    );
  }
  return { text: appendedText, applied: true };
}

function deriveGeneratedCardMutationTimestamp(
  currentTime: Date,
  storedClientUpdatedAt: string | Date,
): string {
  return new Date(Math.max(
    currentTime.getTime(), new Date(storedClientUpdatedAt).getTime() + 1,
  )).toISOString();
}

export function buildManagedImageMarkdownReference(mediaAssetId: string, altText: string): string {
  return buildNormalizedManagedImageMarkdownReference(
    expectUuidString(mediaAssetId, "mediaAssetId"),
    normalizeManagedImageAltText(altText),
  );
}

export function appendManagedImageToCardText(
  text: string,
  mediaAssetId: string,
  altText: string,
): AppendedManagedImageCardText {
  const normalizedMediaAssetId = expectUuidString(mediaAssetId, "mediaAssetId");
  const markdownReference = buildNormalizedManagedImageMarkdownReference(
    normalizedMediaAssetId,
    normalizeManagedImageAltText(altText),
  );
  return appendNormalizedManagedImageToCardText(
    text,
    normalizedMediaAssetId,
    markdownReference,
    buildReadyManagedImageUrl(normalizedMediaAssetId),
  );
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

async function loadCardRowForMutation(
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

async function loadActiveCardRowForMutation(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
): Promise<CardRow | undefined> {
  const result = await executor.query<CardRow>(
    [
      CARD_SELECT,
      "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, cardId],
  );

  return result.rows[0];
}

async function applyLockedManagedImageCardTextMutationInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  targetSide: CardTextSide,
  metadata: CardMutationMetadata,
  hotChangeWriteLock: HotChangeWriteLock,
  row: CardRow,
  mutateText: (currentText: string) => AppendedManagedImageCardText,
): Promise<AppendManagedImageToCardSideResult> {
  const currentText = targetSide === "front" ? row.front_text : row.back_text;
  const mutatedText = mutateText(currentText);
  if (!mutatedText.applied) {
    return { card: mapCard(row), applied: false };
  }

  const generatedClientUpdatedAt = deriveGeneratedCardMutationTimestamp(
    new Date(),
    row.client_updated_at,
  );
  const targetColumn = cardTextColumnBySide[targetSide];
  const updateResult = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      `SET ${targetColumn} = $1, client_updated_at = $2,`,
      "last_modified_by_replica_id = $3, last_operation_id = $4, updated_at = now()",
      "WHERE workspace_id = $5 AND card_id = $6",
      "AND deleted_at IS NOT DISTINCT FROM $7::timestamptz",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [
      mutatedText.text,
      generatedClientUpdatedAt,
      metadata.lastModifiedByReplicaId,
      metadata.lastOperationId,
      workspaceId,
      cardId,
      row.deleted_at,
    ],
  );

  const updatedRow = updateResult.rows[0];
  if (updatedRow === undefined) {
    throw new Error("Locked card row disappeared before managed-image mutation");
  }

  const card = mapCard(updatedRow);
  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, card);
  return { card, applied: true };
}

async function applyManagedImageCardTextMutationInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  targetSide: CardTextSide,
  metadata: CardMutationMetadata,
  mutateText: (currentText: string) => AppendedManagedImageCardText,
): Promise<AppendManagedImageToCardSideResult> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    workspaceId,
  );
  const row = await loadActiveCardRowForMutation(executor, workspaceId, cardId);
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return applyLockedManagedImageCardTextMutationInExecutor(
    executor,
    workspaceId,
    cardId,
    targetSide,
    metadata,
    hotChangeWriteLock,
    row,
    mutateText,
  );
}

async function applyManagedImageLifecycleTransitionInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cardId: string,
  targetSide: CardTextSide,
  metadata: CardMutationMetadata,
  mutateText: (currentText: string) => AppendedManagedImageCardText,
): Promise<AppendManagedImageToCardSideResult> {
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    workspaceId,
  );
  const row = await loadCardRowForMutation(executor, workspaceId, cardId);
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  return applyLockedManagedImageCardTextMutationInExecutor(
    executor,
    workspaceId,
    cardId,
    targetSide,
    metadata,
    hotChangeWriteLock,
    row,
    mutateText,
  );
}

export async function appendManagedImageToCardSideInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: AppendManagedImageToCardSideInput,
  metadata: CardMutationMetadata,
): Promise<AppendManagedImageToCardSideResult> {
  const targetSide = normalizeCardTextSide(input.targetSide);
  const cardId = expectUuidString(input.cardId, "cardId");
  const mediaAssetId = expectUuidString(input.mediaAssetId, "mediaAssetId");
  const normalizedAltText = normalizeManagedImageAltText(input.altText);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);
  const readyUrl = buildReadyManagedImageUrl(mediaAssetId);

  return applyManagedImageCardTextMutationInExecutor(
    executor,
    workspaceId,
    cardId,
    targetSide,
    normalizedMetadata,
    (currentText) => appendNormalizedManagedImageToCardText(
      currentText,
      mediaAssetId,
      buildNormalizedManagedImageMarkdownReference(mediaAssetId, normalizedAltText),
      readyUrl,
    ),
  );
}

export async function appendPendingManagedImageToCardSideInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: AppendManagedImageToCardSideInput,
  metadata: CardMutationMetadata,
): Promise<AppendPendingManagedImageToCardSideResult> {
  const targetSide = normalizeCardTextSide(input.targetSide);
  const cardId = expectUuidString(input.cardId, "cardId");
  const mediaAssetId = expectUuidString(input.mediaAssetId, "mediaAssetId");
  const pendingUrl = buildPendingManagedImageUrl(mediaAssetId);
  const markdownReference = buildPendingManagedImageMarkdownReference(
    mediaAssetId,
    normalizeManagedImageAltText(input.altText),
  );
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);
  const result = await applyManagedImageCardTextMutationInExecutor(
    executor,
    workspaceId,
    cardId,
    targetSide,
    normalizedMetadata,
    (currentText) => appendNormalizedManagedImageToCardText(
      currentText,
      mediaAssetId,
      markdownReference,
      pendingUrl,
    ),
  );
  const cardText = targetSide === "front" ? result.card.frontText : result.card.backText;
  return {
    ...result,
    placeholderApplied: hasExactManagedImageUrl(cardText, pendingUrl),
  };
}

export async function hasPendingManagedImageOnCardSideInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: AppendManagedImageToCardSideInput,
): Promise<boolean> {
  const targetSide = normalizeCardTextSide(input.targetSide);
  const cardId = expectUuidString(input.cardId, "cardId");
  const mediaAssetId = expectUuidString(input.mediaAssetId, "mediaAssetId");
  normalizeManagedImageAltText(input.altText);
  await lockWorkspaceSyncMetadataForHotChangesInExecutor(executor, workspaceId);
  const row = await loadCardRowForMutation(executor, workspaceId, cardId);
  if (row === undefined) {
    return false;
  }

  const cardText = targetSide === "front" ? row.front_text : row.back_text;
  return hasExactManagedImageUrl(cardText, buildPendingManagedImageUrl(mediaAssetId));
}

export async function markPendingManagedImageReadyOnCardSideInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: AppendManagedImageToCardSideInput,
  metadata: CardMutationMetadata,
  beforeCardChange: (lockedExecutor: DatabaseExecutor) => Promise<void>,
): Promise<AppendManagedImageToCardSideResult> {
  const targetSide = normalizeCardTextSide(input.targetSide);
  const cardId = expectUuidString(input.cardId, "cardId");
  const mediaAssetId = expectUuidString(input.mediaAssetId, "mediaAssetId");
  normalizeManagedImageAltText(input.altText);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);
  const pendingUrl = buildPendingManagedImageUrl(mediaAssetId);
  const readyUrl = buildReadyManagedImageUrl(mediaAssetId);
  const hotChangeWriteLock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
    executor,
    workspaceId,
  );
  const row = await loadCardRowForMutation(executor, workspaceId, cardId);
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }
  const currentText = targetSide === "front" ? row.front_text : row.back_text;
  let transitionedText: string;
  try {
    const pendingMarkerCount = extractMarkdownImageDestinationUrls(currentText)
      .filter((destination) => destination === pendingUrl)
      .length;
    if (pendingMarkerCount !== 1) {
      throw new PendingManagedImageSettlementConflictError(
        targetSide,
        pendingMarkerCount,
      );
    }
    transitionedText = rewriteMarkdownImageDestinationUrl(
      currentText,
      pendingUrl,
      readyUrl,
    );
  } catch (error) {
    return translateManagedImageSettlementParserError(error, targetSide);
  }

  await beforeCardChange(executor);
  return applyLockedManagedImageCardTextMutationInExecutor(
    executor,
    workspaceId,
    cardId,
    targetSide,
    normalizedMetadata,
    hotChangeWriteLock,
    row,
    () => ({ text: transitionedText, applied: true }),
  );
}

export async function markPendingManagedImageFailedOnCardSideInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: AppendManagedImageToCardSideInput,
  metadata: CardMutationMetadata,
): Promise<AppendManagedImageToCardSideResult> {
  const targetSide = normalizeCardTextSide(input.targetSide);
  const cardId = expectUuidString(input.cardId, "cardId");
  const mediaAssetId = expectUuidString(input.mediaAssetId, "mediaAssetId");
  normalizeManagedImageAltText(input.altText);
  const normalizedMetadata = normalizeCardMutationMetadata(metadata);

  return applyManagedImageLifecycleTransitionInExecutor(
    executor,
    workspaceId,
    cardId,
    targetSide,
    normalizedMetadata,
    (currentText) => {
      try {
        const failedText = rewriteMarkdownImageDestinationUrl(
          currentText,
          buildPendingManagedImageUrl(mediaAssetId),
          buildFailedManagedImageUrl(mediaAssetId),
        );
        return {
          text: failedText,
          applied: failedText !== currentText,
        };
      } catch (error) {
        return translateManagedImageSettlementParserError(error, targetSide);
      }
    },
  );
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

export async function upsertCardSnapshotInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CardSnapshotInput,
  metadata: CardMutationMetadata,
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
      normalizedInput.frontText,
      normalizedInput.backText,
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
      normalizedMetadata.clientUpdatedAt,
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
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => (
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
  return card;
}

export async function createCard(
  userId: string,
  workspaceId: string,
  input: CreateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transactionWithWorkspaceScope(
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

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
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

  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      `SET ${updateParts.assignments.join(", ")}, client_updated_at = $${params.length - 4},`,
      `last_modified_by_replica_id = $${params.length - 3}, last_operation_id = $${params.length - 2}, updated_at = now()`,
      `WHERE workspace_id = $${params.length - 1} AND card_id = $${params.length} AND deleted_at IS NULL`,
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    params,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const card = mapCard(row);
  await recordCardSyncChange(executor, workspaceId, hotChangeWriteLock, card);
  return card;
}

export async function updateCard(
  userId: string,
  workspaceId: string,
  cardId: string,
  input: UpdateCardInput,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transactionWithWorkspaceScope(
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

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
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
  return card;
}

export async function deleteCard(
  userId: string,
  workspaceId: string,
  cardId: string,
  metadata: CardMutationMetadata,
): Promise<Card> {
  return transactionWithWorkspaceScope(
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

  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
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
