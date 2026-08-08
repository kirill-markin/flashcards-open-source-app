import type { DatabaseExecutor } from "../database";
import { expectUuidString } from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import {
  lockWorkspaceSyncMetadataForHotChangesInExecutor,
  type HotChangeWriteLock,
} from "../sync/replication/changes";
import {
  extractMarkdownImageDestinationUrls,
  isMarkdownComplexityLimitError,
  rewriteMarkdownImageDestinationUrl,
} from "../workspacePackages/markdownMedia";
import {
  CARD_COLUMNS,
  CARD_SELECT,
  loadCardRowForMutation,
  mapCard,
  normalizeCardMutationMetadata,
  recordCardSyncChange,
} from "./shared";
import type {
  AppendManagedImageToCardSideInput,
  AppendManagedImageToCardSideResult,
  AppendPendingManagedImageToCardSideResult,
  CardMutationMetadata,
  CardRow,
  CardTextSide,
} from "./types";

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
