import { normalizeIsoTimestamp } from "../../../sync/conflicts/lww";
import {
  planCardImportTags,
  type CardImportTagPlan,
} from "../../../shared/cardImportTags";
import {
  rewriteMarkdownPortableMediaUrlsToFcAssets,
} from "../../markdownMedia";
import {
  parseWorkspacePackageCardsJsonV1,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageCardSourceMetadataV1,
  type WorkspacePackageCardsJsonV1,
} from "../../types";

export type WorkspacePackageImportPlanOptions = Readonly<{
  addImportTag: boolean;
  importTag: string;
  removeTags: ReadonlyArray<string>;
  importedAt: string;
  importId: string;
}>;

export type WorkspacePackageImportPlanInput = Readonly<{
  cardsJson: WorkspacePackageCardsJsonV1;
  options: WorkspacePackageImportPlanOptions;
  mediaAssetIdsByPortablePath: ReadonlyMap<string, string>;
}>;

export type WorkspacePackageImportPlanPreflightInput = Readonly<{
  cardsJson: WorkspacePackageCardsJsonV1;
  options: WorkspacePackageImportPlanOptions;
}>;

export type WorkspacePackageImportPlannedCard = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  cardType: string;
  metadata: WorkspacePackageCardMetadataV1;
}>;

export type WorkspacePackageImportPlanSummary = Readonly<{
  cardCount: number;
  keptTagCount: number;
  removedTagCount: number;
  importTag: string | null;
  referencedMediaCount: number;
}>;

export type WorkspacePackageImportPlan = Readonly<{
  cards: ReadonlyArray<WorkspacePackageImportPlannedCard>;
  summary: WorkspacePackageImportPlanSummary;
}>;

type WorkspacePackageImportPlanNormalizedOptions = WorkspacePackageImportPlanOptions;

function createImportPlanInputError(message: string): TypeError {
  return new TypeError(`Invalid workspace package import plan input: ${message}`);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw createImportPlanInputError(`${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeRequiredIsoTimestamp(value: string, fieldName: string): string {
  return normalizeIsoTimestamp(normalizeRequiredText(value, fieldName), fieldName);
}

function normalizeImportPlanOptions(
  options: WorkspacePackageImportPlanOptions,
): WorkspacePackageImportPlanNormalizedOptions {
  return {
    addImportTag: options.addImportTag,
    importTag: options.importTag,
    removeTags: options.removeTags,
    importedAt: normalizeRequiredIsoTimestamp(options.importedAt, "options.importedAt"),
    importId: normalizeRequiredText(options.importId, "options.importId"),
  };
}

function normalizeImportPlanCardsJson(cardsJson: WorkspacePackageCardsJsonV1): WorkspacePackageCardsJsonV1 {
  try {
    return parseWorkspacePackageCardsJsonV1(cardsJson);
  } catch (error) {
    throw createImportPlanInputError(`cardsJson must be a valid workspace package. reason=${getErrorMessage(error)}`);
  }
}

function createWorkspacePackageImportTagPlan(
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>,
  options: WorkspacePackageImportPlanNormalizedOptions,
): CardImportTagPlan {
  try {
    return planCardImportTags(cards, options);
  } catch (error) {
    throw createImportPlanInputError(
      `tag options are invalid. reason=${getErrorMessage(error)}`,
    );
  }
}

function toPackageSourceMetadata(
  cardsJson: WorkspacePackageCardsJsonV1,
): WorkspacePackageCardSourceMetadataV1 {
  return {
    label: cardsJson.label ?? null,
    author: cardsJson.author ?? null,
    comment: cardsJson.comment ?? null,
    createdAt: cardsJson.createdAt ?? null,
    importedAt: null,
    importId: null,
  };
}

function planCardSourceMetadata(
  cardSource: WorkspacePackageCardSourceMetadataV1 | null,
  packageSource: WorkspacePackageCardSourceMetadataV1,
  options: WorkspacePackageImportPlanNormalizedOptions,
): WorkspacePackageCardSourceMetadataV1 {
  return {
    label: cardSource?.label ?? packageSource.label,
    author: cardSource?.author ?? packageSource.author,
    comment: cardSource?.comment ?? packageSource.comment,
    createdAt: cardSource?.createdAt ?? packageSource.createdAt,
    importedAt: options.importedAt,
    importId: options.importId,
  };
}

function planCardMetadata(
  card: PortableWorkspacePackageCardV1,
  packageSource: WorkspacePackageCardSourceMetadataV1,
  options: WorkspacePackageImportPlanNormalizedOptions,
): WorkspacePackageCardMetadataV1 {
  return {
    version: 1,
    source: planCardSourceMetadata(card.metadata.source, packageSource, options),
  };
}

function resolvePortableMediaPath(
  portableMediaPath: string,
  mediaAssetIdsByPortablePath: ReadonlyMap<string, string>,
  referencedMediaPaths: Set<string>,
): string {
  referencedMediaPaths.add(portableMediaPath);
  const mediaAssetId = mediaAssetIdsByPortablePath.get(portableMediaPath);
  if (mediaAssetId === undefined) {
    throw new Error(`Missing mediaAssetId mapping for portable media path: ${portableMediaPath}`);
  }

  return mediaAssetId;
}

function rewriteCardMarkdown(
  markdown: string,
  mediaAssetIdsByPortablePath: ReadonlyMap<string, string>,
  referencedMediaPaths: Set<string>,
  cardIndex: number,
  fieldName: "frontText" | "backText",
): string {
  try {
    return rewriteMarkdownPortableMediaUrlsToFcAssets(
      markdown,
      (portableMediaPath) => resolvePortableMediaPath(
        portableMediaPath,
        mediaAssetIdsByPortablePath,
        referencedMediaPaths,
      ),
    );
  } catch (error) {
    throw createImportPlanInputError(
      `cards[${cardIndex}].${fieldName} media references cannot be planned. reason=${getErrorMessage(error)}`,
    );
  }
}

function planCard(
  card: PortableWorkspacePackageCardV1,
  cardIndex: number,
  tags: ReadonlyArray<string>,
  packageSource: WorkspacePackageCardSourceMetadataV1,
  options: WorkspacePackageImportPlanNormalizedOptions,
  mediaAssetIdsByPortablePath: ReadonlyMap<string, string>,
  referencedMediaPaths: Set<string>,
): WorkspacePackageImportPlannedCard {
  return {
    frontText: rewriteCardMarkdown(
      card.frontText,
      mediaAssetIdsByPortablePath,
      referencedMediaPaths,
      cardIndex,
      "frontText",
    ),
    backText: rewriteCardMarkdown(
      card.backText,
      mediaAssetIdsByPortablePath,
      referencedMediaPaths,
      cardIndex,
      "backText",
    ),
    tags,
    cardType: card.cardType,
    metadata: planCardMetadata(card, packageSource, options),
  };
}

function getPlannedCardTags(
  cardTags: ReadonlyArray<ReadonlyArray<string>>,
  cardIndex: number,
): ReadonlyArray<string> {
  const tags = cardTags[cardIndex];
  if (tags === undefined) {
    throw new Error(`Missing planned card tags. cardIndex=${cardIndex}`);
  }

  return tags;
}

export function planWorkspacePackageImport(input: WorkspacePackageImportPlanInput): WorkspacePackageImportPlan {
  const cardsJson = normalizeImportPlanCardsJson(input.cardsJson);
  const options = normalizeImportPlanOptions(input.options);
  const packageSource = toPackageSourceMetadata(cardsJson);
  const tagPlan = createWorkspacePackageImportTagPlan(cardsJson.cards, options);
  const referencedMediaPaths = new Set<string>();
  const plannedCards = cardsJson.cards.map((card, cardIndex) => planCard(
    card,
    cardIndex,
    getPlannedCardTags(tagPlan.cardTags, cardIndex),
    packageSource,
    options,
    input.mediaAssetIdsByPortablePath,
    referencedMediaPaths,
  ));

  return {
    cards: plannedCards,
    summary: {
      cardCount: plannedCards.length,
      keptTagCount: tagPlan.keptTags.length,
      removedTagCount: tagPlan.removedTags.length,
      importTag: tagPlan.importTag,
      referencedMediaCount: referencedMediaPaths.size,
    },
  };
}

export function validateWorkspacePackageImportPlanPreflight(
  input: WorkspacePackageImportPlanPreflightInput,
): void {
  const cardsJson = normalizeImportPlanCardsJson(input.cardsJson);
  const options = normalizeImportPlanOptions(input.options);
  createWorkspacePackageImportTagPlan(cardsJson.cards, options);
}
