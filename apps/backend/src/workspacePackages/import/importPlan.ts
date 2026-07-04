import { normalizeIsoTimestamp } from "../../sync/conflicts/lww";
import {
  rewriteMarkdownPortableMediaUrlsToFcAssets,
} from "../markdownMedia";
import {
  parseWorkspacePackageCardsJsonV1,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageCardSourceMetadataV1,
  type WorkspacePackageCardsJsonV1,
} from "../types";

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

type WorkspacePackageImportPlanTagPolicy = Readonly<{
  keptTags: ReadonlyArray<string>;
  removedTags: ReadonlyArray<string>;
  removedTagSet: ReadonlySet<string>;
}>;

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

function normalizeRequiredUniqueTextValues(
  values: ReadonlyArray<string>,
  fieldName: string,
): ReadonlyArray<string> {
  const normalizedValues: Array<string> = [];
  const seenValues = new Set<string>();

  values.forEach((value, index) => {
    const normalizedValue = normalizeRequiredText(value, `${fieldName}[${index}]`);
    if (seenValues.has(normalizedValue)) {
      throw createImportPlanInputError(`${fieldName} must not contain duplicates`);
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  });

  return normalizedValues;
}

function normalizeImportPlanOptions(
  options: WorkspacePackageImportPlanOptions,
): WorkspacePackageImportPlanNormalizedOptions {
  return {
    addImportTag: options.addImportTag,
    importTag: normalizeImportTag(options.addImportTag, options.importTag),
    removeTags: normalizeRequiredUniqueTextValues(options.removeTags, "options.removeTags"),
    importedAt: normalizeRequiredIsoTimestamp(options.importedAt, "options.importedAt"),
    importId: normalizeRequiredText(options.importId, "options.importId"),
  };
}

function normalizeImportTag(addImportTag: boolean, importTag: string): string {
  if (addImportTag) {
    return normalizeRequiredText(importTag, "options.importTag");
  }

  return importTag.trim();
}

function normalizeImportPlanCardsJson(cardsJson: WorkspacePackageCardsJsonV1): WorkspacePackageCardsJsonV1 {
  try {
    return parseWorkspacePackageCardsJsonV1(cardsJson);
  } catch (error) {
    throw createImportPlanInputError(`cardsJson must be a valid workspace package. reason=${getErrorMessage(error)}`);
  }
}

function collectPackageTags(
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>,
): ReadonlyArray<string> {
  const packageTags: Array<string> = [];
  const seenTags = new Set<string>();

  for (const card of cards) {
    for (const tag of card.tags) {
      if (seenTags.has(tag)) {
        continue;
      }

      seenTags.add(tag);
      packageTags.push(tag);
    }
  }

  return packageTags;
}

function buildImportPlanTagPolicy(
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>,
  options: WorkspacePackageImportPlanNormalizedOptions,
): WorkspacePackageImportPlanTagPolicy {
  const packageTags = collectPackageTags(cards);
  const packageTagSet = new Set(packageTags);
  const unknownRemovedTags = options.removeTags.filter((tag) => packageTagSet.has(tag) === false);
  if (unknownRemovedTags.length !== 0) {
    throw createImportPlanInputError(
      `options.removeTags must contain only exact package tag values. unknownTags=${unknownRemovedTags.join(",")}`,
    );
  }

  const removedTagSet = new Set(options.removeTags);
  return {
    keptTags: packageTags.filter((tag) => removedTagSet.has(tag) === false),
    removedTags: options.removeTags,
    removedTagSet,
  };
}

function dedupeTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  const dedupedTags: Array<string> = [];
  const seenTags = new Set<string>();

  for (const tag of tags) {
    if (seenTags.has(tag)) {
      continue;
    }

    seenTags.add(tag);
    dedupedTags.push(tag);
  }

  return dedupedTags;
}

function planCardTags(
  cardTags: ReadonlyArray<string>,
  options: WorkspacePackageImportPlanNormalizedOptions,
  tagPolicy: WorkspacePackageImportPlanTagPolicy,
): ReadonlyArray<string> {
  const keptCardTags = cardTags.filter((tag) => tagPolicy.removedTagSet.has(tag) === false);
  const finalTags = options.addImportTag ? [...keptCardTags, options.importTag] : keptCardTags;
  return dedupeTags(finalTags);
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
  packageSource: WorkspacePackageCardSourceMetadataV1,
  options: WorkspacePackageImportPlanNormalizedOptions,
  tagPolicy: WorkspacePackageImportPlanTagPolicy,
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
    tags: planCardTags(card.tags, options, tagPolicy),
    cardType: card.cardType,
    metadata: planCardMetadata(card, packageSource, options),
  };
}

export function planWorkspacePackageImport(input: WorkspacePackageImportPlanInput): WorkspacePackageImportPlan {
  const cardsJson = normalizeImportPlanCardsJson(input.cardsJson);
  const options = normalizeImportPlanOptions(input.options);
  const packageSource = toPackageSourceMetadata(cardsJson);
  const tagPolicy = buildImportPlanTagPolicy(cardsJson.cards, options);
  const referencedMediaPaths = new Set<string>();
  const plannedCards = cardsJson.cards.map((card, cardIndex) => planCard(
    card,
    cardIndex,
    packageSource,
    options,
    tagPolicy,
    input.mediaAssetIdsByPortablePath,
    referencedMediaPaths,
  ));

  return {
    cards: plannedCards,
    summary: {
      cardCount: plannedCards.length,
      keptTagCount: tagPolicy.keptTags.length,
      removedTagCount: tagPolicy.removedTags.length,
      importTag: options.addImportTag ? options.importTag : null,
      referencedMediaCount: referencedMediaPaths.size,
    },
  };
}

export function validateWorkspacePackageImportPlanPreflight(
  input: WorkspacePackageImportPlanPreflightInput,
): void {
  const cardsJson = normalizeImportPlanCardsJson(input.cardsJson);
  const options = normalizeImportPlanOptions(input.options);
  buildImportPlanTagPolicy(cardsJson.cards, options);
}
