import {
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
  type SqlValue,
} from "../database";
import { MEDIA_ASSET_JOIN_CLAUSE } from "../mediaAssets";
import { HttpError } from "../shared/errors";
import { extractMarkdownFcAssetIds } from "./markdownMedia";
import type { WorkspacePackageMetadataV1 } from "./types";

export const workspacePackageExportPreviewDefaultMaxSelectedCards = 5_000;

export type WorkspacePackageExportCardSelection =
  | Readonly<{
    kind: "allActiveCards";
  }>
  | Readonly<{
    kind: "tagFilters";
    includeTags: ReadonlyArray<string>;
    excludeTags: ReadonlyArray<string>;
  }>
  | Readonly<{
    kind: "explicitCardIds";
    cardIds: ReadonlyArray<string>;
  }>;

export type WorkspacePackageExportTagPolicyInput = Readonly<{
  additionalRemovedTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageExportMetadataInput = Readonly<{
  label: string | null;
  author: string | null;
  comment: string | null;
  createdAt: string | null;
  sourceUrl: string | null;
}>;

export type WorkspacePackageExportPreviewInput = Readonly<{
  selection: WorkspacePackageExportCardSelection;
  tagPolicy: WorkspacePackageExportTagPolicyInput;
  packageMetadata: WorkspacePackageExportMetadataInput;
  generatedAt: string;
}>;

export type WorkspacePackageExportPreviewTagCount = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type WorkspacePackageExportPreview = Readonly<{
  selectedCardCount: number;
  availableTagCounts: ReadonlyArray<WorkspacePackageExportPreviewTagCount>;
  tagsSelectedForRemoval: ReadonlyArray<WorkspacePackageExportPreviewTagCount>;
  referencedMediaCount: number;
  approximateReferencedMediaBytes: number;
  defaultPackageMetadata: WorkspacePackageMetadataV1;
}>;

export type WorkspacePackageExportPreviewLimits = Readonly<{
  maxSelectedCards: number;
}>;

type WorkspacePackageExportPreviewCardRow = Readonly<{
  card_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
}>;

type WorkspacePackageExportPreviewMediaRow = Readonly<{
  media_asset_id: string;
  media_blob_id: string;
  size_bytes: string | number;
}>;

type SelectedCardsQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
  explicitCardIds: ReadonlyArray<string> | null;
}>;

const workspacePackageExportMetadataDefaultLabel = "Workspace export";
const workspacePackageExportImportTagPrefix = "import:";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function createPreviewInputError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_EXPORT_PREVIEW_INPUT_INVALID");
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw createPreviewInputError(`${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeNullableText(value: string | null, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return normalizeNonEmptyText(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const normalizedValue = normalizeNonEmptyText(value, fieldName);
  const parsedValue = new Date(normalizedValue);
  if (Number.isNaN(parsedValue.getTime())) {
    throw createPreviewInputError(`${fieldName} must be a valid ISO timestamp`);
  }

  return parsedValue.toISOString();
}

function normalizeUniqueTextValues(
  values: ReadonlyArray<string>,
  fieldName: string,
): ReadonlyArray<string> {
  const normalizedValues: Array<string> = [];
  const existingValues = new Set<string>();

  values.forEach((value, index) => {
    const normalizedValue = normalizeNonEmptyText(value, `${fieldName}[${index}]`);
    if (existingValues.has(normalizedValue)) {
      return;
    }

    existingValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  });

  return normalizedValues;
}

function normalizeUniqueUuidValues(
  values: ReadonlyArray<string>,
  fieldName: string,
): ReadonlyArray<string> {
  const normalizedValues = normalizeUniqueTextValues(values, fieldName);
  const invalidValues = normalizedValues.filter((value) => uuidPattern.test(value) === false);
  if (invalidValues.length !== 0) {
    throw createPreviewInputError(`${fieldName} must contain only UUID values. invalidValues=${invalidValues.join(",")}`);
  }

  if (normalizedValues.length !== values.length) {
    throw createPreviewInputError(`${fieldName} must not contain duplicates`);
  }

  return normalizedValues;
}

function normalizeCardSelection(
  selection: WorkspacePackageExportCardSelection,
): WorkspacePackageExportCardSelection {
  switch (selection.kind) {
  case "allActiveCards":
    return selection;
  case "tagFilters":
    return {
      kind: "tagFilters",
      includeTags: normalizeUniqueTextValues(selection.includeTags, "selection.includeTags"),
      excludeTags: normalizeUniqueTextValues(selection.excludeTags, "selection.excludeTags"),
    };
  case "explicitCardIds":
    return {
      kind: "explicitCardIds",
      cardIds: normalizeUniqueUuidValues(selection.cardIds, "selection.cardIds"),
    };
  }
}

function normalizePreviewLimits(limits: WorkspacePackageExportPreviewLimits): WorkspacePackageExportPreviewLimits {
  if (
    Number.isSafeInteger(limits.maxSelectedCards) === false
    || limits.maxSelectedCards < 1
    || limits.maxSelectedCards >= Number.MAX_SAFE_INTEGER
  ) {
    throw createPreviewInputError("limits.maxSelectedCards must be a positive safe integer");
  }

  return limits;
}

function normalizePackageMetadata(
  input: WorkspacePackageExportMetadataInput,
  generatedAt: string,
): WorkspacePackageMetadataV1 {
  const label = normalizeNullableText(input.label, "packageMetadata.label") ?? workspacePackageExportMetadataDefaultLabel;
  const author = normalizeNullableText(input.author, "packageMetadata.author");
  const comment = normalizeNullableText(input.comment, "packageMetadata.comment");
  const createdAt = input.createdAt === null
    ? generatedAt
    : normalizeIsoTimestamp(input.createdAt, "packageMetadata.createdAt");
  const sourceUrl = normalizeNullableText(input.sourceUrl, "packageMetadata.sourceUrl");

  return {
    label,
    ...(author === null ? {} : { author }),
    ...(comment === null ? {} : { comment }),
    createdAt,
    ...(sourceUrl === null ? {} : { sourceUrl }),
  };
}

function buildSelectedCardsQuery(
  workspaceId: string,
  selection: WorkspacePackageExportCardSelection,
  maxSelectedCards: number,
): SelectedCardsQuery {
  const rowLimit = maxSelectedCards + 1;

  switch (selection.kind) {
  case "allActiveCards":
    return {
      text: [
        "SELECT card_id, front_text, back_text, tags",
        "FROM content.cards",
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        "ORDER BY created_at DESC, card_id ASC",
        "LIMIT $2",
      ].join(" "),
      params: [workspaceId, rowLimit],
      explicitCardIds: null,
    };
  case "tagFilters": {
    const params: Array<SqlValue> = [workspaceId];
    const clauses: Array<string> = [
      "WHERE workspace_id = $1",
      "AND deleted_at IS NULL",
    ];

    if (selection.includeTags.length > 0) {
      params.push(selection.includeTags);
      clauses.push(`AND tags && $${params.length}::text[]`);
    }

    if (selection.excludeTags.length > 0) {
      params.push(selection.excludeTags);
      clauses.push(`AND NOT (tags && $${params.length}::text[])`);
    }

    params.push(rowLimit);
    return {
      text: [
        "SELECT card_id, front_text, back_text, tags",
        "FROM content.cards",
        clauses.join(" "),
        "ORDER BY created_at DESC, card_id ASC",
        `LIMIT $${params.length}`,
      ].join(" "),
      params,
      explicitCardIds: null,
    };
  }
  case "explicitCardIds":
    return {
      text: [
        "SELECT card_id, front_text, back_text, tags",
        "FROM content.cards",
        "WHERE workspace_id = $1",
        "AND card_id = ANY($2::uuid[])",
        "AND deleted_at IS NULL",
        "ORDER BY array_position($2::uuid[], card_id)",
        "LIMIT $3",
      ].join(" "),
      params: [workspaceId, selection.cardIds, rowLimit],
      explicitCardIds: selection.cardIds,
    };
  }
}

function assertSelectionWithinLimit(
  selectedCardCount: number,
  maxSelectedCards: number,
): void {
  if (selectedCardCount <= maxSelectedCards) {
    return;
  }

  throw new HttpError(
    413,
    `Workspace package export preview selection is too large. selectedCardLimit=${maxSelectedCards}`,
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_SELECTION_TOO_LARGE",
  );
}

function assertExplicitCardsFound(
  rows: ReadonlyArray<WorkspacePackageExportPreviewCardRow>,
  explicitCardIds: ReadonlyArray<string> | null,
): void {
  if (explicitCardIds === null) {
    return;
  }

  const returnedCardIds = new Set(rows.map((row) => row.card_id));
  const missingCardIds = explicitCardIds.filter((cardId) => returnedCardIds.has(cardId) === false);
  if (missingCardIds.length === 0) {
    return;
  }

  throw new HttpError(
    404,
    `Workspace package export preview selection contains unavailable cards. missingCardIds=${missingCardIds.join(",")}`,
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_CARD_NOT_FOUND",
  );
}

async function loadSelectedCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  selection: WorkspacePackageExportCardSelection,
  limits: WorkspacePackageExportPreviewLimits,
): Promise<ReadonlyArray<WorkspacePackageExportPreviewCardRow>> {
  if (selection.kind === "explicitCardIds") {
    assertSelectionWithinLimit(selection.cardIds.length, limits.maxSelectedCards);
  }

  const query = buildSelectedCardsQuery(workspaceId, selection, limits.maxSelectedCards);
  const result = await executor.query<WorkspacePackageExportPreviewCardRow>(query.text, query.params);
  assertSelectionWithinLimit(result.rows.length, limits.maxSelectedCards);
  assertExplicitCardsFound(result.rows, query.explicitCardIds);

  return result.rows;
}

function toSafeNumber(value: string | number, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isSafeInteger(parsedValue) === false) {
    throw new Error(`${fieldName} must be a safe integer`);
  }

  return parsedValue;
}

function compareTagCounts(
  left: WorkspacePackageExportPreviewTagCount,
  right: WorkspacePackageExportPreviewTagCount,
): number {
  const countDifference = right.cardsCount - left.cardsCount;
  if (countDifference !== 0) {
    return countDifference;
  }

  const normalizedTagDifference = left.tag.toLowerCase().localeCompare(right.tag.toLowerCase());
  if (normalizedTagDifference !== 0) {
    return normalizedTagDifference;
  }

  return left.tag.localeCompare(right.tag);
}

function buildAvailableTagCounts(
  cards: ReadonlyArray<WorkspacePackageExportPreviewCardRow>,
): ReadonlyArray<WorkspacePackageExportPreviewTagCount> {
  const tagCounts = new Map<string, number>();

  for (const card of cards) {
    for (const tag of card.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, cardsCount]) => ({ tag, cardsCount }))
    .sort(compareTagCounts);
}

function buildTagsSelectedForRemoval(
  availableTagCounts: ReadonlyArray<WorkspacePackageExportPreviewTagCount>,
  tagPolicy: WorkspacePackageExportTagPolicyInput,
): ReadonlyArray<WorkspacePackageExportPreviewTagCount> {
  const additionalRemovedTags = new Set(tagPolicy.additionalRemovedTags);

  return availableTagCounts.filter((tagCount) => (
    tagCount.tag.startsWith(workspacePackageExportImportTagPrefix)
    || additionalRemovedTags.has(tagCount.tag)
  ));
}

function normalizeTagPolicy(tagPolicy: WorkspacePackageExportTagPolicyInput): WorkspacePackageExportTagPolicyInput {
  return {
    additionalRemovedTags: normalizeUniqueTextValues(
      tagPolicy.additionalRemovedTags,
      "tagPolicy.additionalRemovedTags",
    ),
  };
}

function extractReferencedMediaAssetIds(
  cards: ReadonlyArray<WorkspacePackageExportPreviewCardRow>,
): ReadonlyArray<string> {
  const mediaAssetIds = new Set<string>();

  for (const card of cards) {
    for (const mediaAssetId of extractMarkdownFcAssetIds(card.front_text)) {
      mediaAssetIds.add(mediaAssetId);
    }

    for (const mediaAssetId of extractMarkdownFcAssetIds(card.back_text)) {
      mediaAssetIds.add(mediaAssetId);
    }
  }

  return [...mediaAssetIds];
}

function assertValidMediaAssetIds(mediaAssetIds: ReadonlyArray<string>): void {
  const invalidMediaAssetIds = mediaAssetIds.filter((mediaAssetId) => uuidPattern.test(mediaAssetId) === false);
  if (invalidMediaAssetIds.length === 0) {
    return;
  }

  throw new HttpError(
    400,
    `Workspace package export preview references invalid media asset ids. invalidMediaAssetIds=${invalidMediaAssetIds.join(",")}`,
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_MEDIA_ASSET_ID_INVALID",
  );
}

function assertReferencedMediaAssetsFound(
  mediaAssetIds: ReadonlyArray<string>,
  rows: ReadonlyArray<WorkspacePackageExportPreviewMediaRow>,
): void {
  const returnedMediaAssetIds = new Set(rows.map((row) => row.media_asset_id));
  const missingMediaAssetIds = mediaAssetIds.filter((mediaAssetId) => returnedMediaAssetIds.has(mediaAssetId) === false);
  if (missingMediaAssetIds.length === 0) {
    return;
  }

  throw new HttpError(
    400,
    `Workspace package export preview references unavailable media assets. mediaAssetIds=${missingMediaAssetIds.join(",")}`,
    "WORKSPACE_PACKAGE_EXPORT_PREVIEW_MEDIA_ASSET_UNAVAILABLE",
  );
}

async function loadReferencedMediaRowsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<WorkspacePackageExportPreviewMediaRow>> {
  if (mediaAssetIds.length === 0) {
    return [];
  }

  assertValidMediaAssetIds(mediaAssetIds);
  const result = await executor.query<WorkspacePackageExportPreviewMediaRow>(
    [
      "SELECT",
      "media_assets.media_asset_id AS media_asset_id,",
      "media_assets.media_blob_id AS media_blob_id,",
      "media_blobs.size_bytes AS size_bytes",
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = ANY($2::uuid[])",
      "AND media_assets.deleted_at IS NULL",
      "ORDER BY array_position($2::uuid[], media_assets.media_asset_id)",
    ].join(" "),
    [workspaceId, mediaAssetIds],
  );
  assertReferencedMediaAssetsFound(mediaAssetIds, result.rows);

  return result.rows;
}

function sumReferencedMediaBytes(
  mediaRows: ReadonlyArray<WorkspacePackageExportPreviewMediaRow>,
): number {
  const countedBlobIds = new Set<string>();
  let totalSizeBytes = 0;

  for (const mediaRow of mediaRows) {
    if (countedBlobIds.has(mediaRow.media_blob_id)) {
      continue;
    }

    countedBlobIds.add(mediaRow.media_blob_id);
    totalSizeBytes += toSafeNumber(mediaRow.size_bytes, "size_bytes");
    if (Number.isSafeInteger(totalSizeBytes) === false) {
      throw new Error("referenced media byte total must be a safe integer");
    }
  }

  return totalSizeBytes;
}

export async function previewWorkspacePackageExportInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: WorkspacePackageExportPreviewInput,
  limits: WorkspacePackageExportPreviewLimits,
): Promise<WorkspacePackageExportPreview> {
  const normalizedGeneratedAt = normalizeIsoTimestamp(input.generatedAt, "generatedAt");
  const normalizedSelection = normalizeCardSelection(input.selection);
  const normalizedTagPolicy = normalizeTagPolicy(input.tagPolicy);
  const defaultPackageMetadata = normalizePackageMetadata(input.packageMetadata, normalizedGeneratedAt);
  const normalizedLimits = normalizePreviewLimits(limits);
  const cards = await loadSelectedCardsInExecutor(
    executor,
    workspaceId,
    normalizedSelection,
    normalizedLimits,
  );
  const availableTagCounts = buildAvailableTagCounts(cards);
  const referencedMediaAssetIds = extractReferencedMediaAssetIds(cards);
  const mediaRows = await loadReferencedMediaRowsInExecutor(executor, workspaceId, referencedMediaAssetIds);

  return {
    selectedCardCount: cards.length,
    availableTagCounts,
    tagsSelectedForRemoval: buildTagsSelectedForRemoval(availableTagCounts, normalizedTagPolicy),
    referencedMediaCount: mediaRows.length,
    approximateReferencedMediaBytes: sumReferencedMediaBytes(mediaRows),
    defaultPackageMetadata,
  };
}

export async function previewWorkspacePackageExport(
  userId: string,
  workspaceId: string,
  input: WorkspacePackageExportPreviewInput,
): Promise<WorkspacePackageExportPreview> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => (
    previewWorkspacePackageExportInExecutor(
      executor,
      workspaceId,
      input,
      { maxSelectedCards: workspacePackageExportPreviewDefaultMaxSelectedCards },
    )
  ));
}
