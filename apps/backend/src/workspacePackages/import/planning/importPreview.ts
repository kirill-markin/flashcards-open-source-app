import { Buffer } from "node:buffer";
import {
  buildSuggestedCardImportTag,
  planCardImportTags,
} from "../../../shared/cardImportTags";
import {
  assertReferencedWorkspacePackageMediaFilesExist,
  assertWorkspacePackageCardCountWithinLimit,
  collectWorkspacePackageZipEntries,
  createWorkspacePackageImportInputError,
  defaultWorkspacePackageImportZipLimits,
  extractReferencedWorkspacePackageMediaPaths,
  normalizeWorkspacePackageImportZipLimits,
  normalizeWorkspacePackageZipBytes,
  openWorkspacePackageZipFile,
  parseWorkspacePackageCardsJsonBytes,
  workspacePackageImportZipDefaultMaxCards,
  workspacePackageImportZipDefaultMaxEntries,
  workspacePackageImportZipDefaultMaxMediaFiles,
  workspacePackageImportZipDefaultMaxSingleMediaBytes,
  workspacePackageImportZipDefaultMaxTotalMediaBytes,
  workspacePackageImportZipDefaultMaxZipBytes,
  type CollectedWorkspacePackageZip,
  type WorkspacePackageImportZipLimits,
} from "../importZip";
import type { WorkspacePackageCardsJsonV1 } from "../../types";

export const workspacePackageImportPreviewDefaultMaxZipBytes = workspacePackageImportZipDefaultMaxZipBytes;
export const workspacePackageImportPreviewDefaultMaxEntries = workspacePackageImportZipDefaultMaxEntries;
export const workspacePackageImportPreviewDefaultMaxCards = workspacePackageImportZipDefaultMaxCards;
export const workspacePackageImportPreviewDefaultMaxMediaFiles = workspacePackageImportZipDefaultMaxMediaFiles;
export const workspacePackageImportPreviewDefaultMaxSingleMediaBytes = workspacePackageImportZipDefaultMaxSingleMediaBytes;
export const workspacePackageImportPreviewDefaultMaxTotalMediaBytes = workspacePackageImportZipDefaultMaxTotalMediaBytes;

export type WorkspacePackageImportPreviewInput = Readonly<{
  packageBytes: Buffer | Uint8Array;
  generatedAt: string;
  existingWorkspaceTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageImportPreviewLimits = WorkspacePackageImportZipLimits;

export type WorkspacePackageImportPreviewMetadata = Readonly<{
  label: string | null;
  author: string | null;
  comment: string | null;
  createdAt: string | null;
  sourceUrl: string | null;
}>;

export type WorkspacePackageImportPreviewTagCount = Readonly<{
  tag: string;
  cardsCount: number;
}>;

export type WorkspacePackageImportPreviewWarning = Readonly<{
  code: string;
  message: string;
  mediaPath: string;
}>;

export type WorkspacePackageImportTagPolicyInput = Readonly<{
  removedTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageImportTagPolicy = Readonly<{
  keptTags: ReadonlyArray<string>;
  removedTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageImportDefaultOptions = WorkspacePackageImportTagPolicy & Readonly<{
  addImportTag: boolean;
  suggestedImportTag: string;
}>;

export type WorkspacePackageImportPreview = Readonly<{
  sourceKind: "zip";
  packageMetadata: WorkspacePackageImportPreviewMetadata;
  cardCount: number;
  tagCounts: ReadonlyArray<WorkspacePackageImportPreviewTagCount>;
  referencedMediaCount: number;
  packageMediaFileCount: number;
  warnings: ReadonlyArray<WorkspacePackageImportPreviewWarning>;
  defaultOptions: WorkspacePackageImportDefaultOptions;
}>;

const supportedPreviewImageExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const defaultImportPreviewLimits: WorkspacePackageImportPreviewLimits = defaultWorkspacePackageImportZipLimits;

function normalizeNonEmptyText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw createWorkspacePackageImportInputError(`${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const normalizedValue = normalizeNonEmptyText(value, fieldName);
  const parsedValue = new Date(normalizedValue);
  if (Number.isNaN(parsedValue.getTime())) {
    throw createWorkspacePackageImportInputError(`${fieldName} must be a valid ISO timestamp`);
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
      throw createWorkspacePackageImportInputError(`${fieldName} must not contain duplicates`);
    }

    existingValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  });

  return normalizedValues;
}

function toPackageMetadataPreview(cardsJson: WorkspacePackageCardsJsonV1): WorkspacePackageImportPreviewMetadata {
  return {
    label: cardsJson.label ?? null,
    author: cardsJson.author ?? null,
    comment: cardsJson.comment ?? null,
    createdAt: cardsJson.createdAt ?? null,
    sourceUrl: cardsJson.sourceUrl ?? null,
  };
}

function getLowercaseFileExtension(mediaPath: string): string | null {
  const fileName = mediaPath.slice(mediaPath.lastIndexOf("/") + 1);
  const extensionSeparatorIndex = fileName.lastIndexOf(".");
  if (extensionSeparatorIndex === -1 || extensionSeparatorIndex === fileName.length - 1) {
    return null;
  }

  return fileName.slice(extensionSeparatorIndex + 1).toLowerCase();
}

function buildUnsupportedMediaWarnings(
  referencedMediaPaths: ReadonlyArray<string>,
): ReadonlyArray<WorkspacePackageImportPreviewWarning> {
  return referencedMediaPaths
    .filter((mediaPath) => {
      const extension = getLowercaseFileExtension(mediaPath);
      return extension === null || supportedPreviewImageExtensions.has(extension) === false;
    })
    .map((mediaPath) => ({
      code: "WORKSPACE_PACKAGE_IMPORT_MEDIA_TYPE_UNSUPPORTED",
      message: "Referenced package media may not be supported by the import confirmation flow.",
      mediaPath,
    }));
}

export function buildSuggestedWorkspacePackageImportTag(
  generatedAt: string,
  existingWorkspaceTags: ReadonlyArray<string>,
): string {
  try {
    return buildSuggestedCardImportTag(generatedAt, existingWorkspaceTags);
  } catch (error) {
    throw createWorkspacePackageImportInputError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function normalizeWorkspacePackageImportTagPolicy(
  tagPolicy: WorkspacePackageImportTagPolicyInput,
  packageTags: ReadonlyArray<string>,
): WorkspacePackageImportTagPolicy {
  const normalizedPackageTags = normalizeUniqueTextValues(packageTags, "packageTags");
  const packageTagSet = new Set(normalizedPackageTags);
  const removedTags = normalizeUniqueTextValues(tagPolicy.removedTags, "tagPolicy.removedTags");
  const unknownRemovedTags = removedTags.filter((tag) => packageTagSet.has(tag) === false);
  if (unknownRemovedTags.length !== 0) {
    throw createWorkspacePackageImportInputError(
      `tagPolicy.removedTags must contain only exact package tag values. unknownTags=${unknownRemovedTags.join(",")}`,
    );
  }

  const removedTagSet = new Set(removedTags);
  return {
    keptTags: normalizedPackageTags.filter((tag) => removedTagSet.has(tag) === false),
    removedTags,
  };
}

export function createDefaultWorkspacePackageImportTagPolicy(
  packageTags: ReadonlyArray<string>,
): WorkspacePackageImportTagPolicy {
  return normalizeWorkspacePackageImportTagPolicy({ removedTags: [] }, packageTags);
}

export async function previewWorkspacePackageZipImportWithLimits(
  input: WorkspacePackageImportPreviewInput,
  limits: WorkspacePackageImportPreviewLimits,
): Promise<WorkspacePackageImportPreview> {
  const normalizedLimits = normalizeWorkspacePackageImportZipLimits(limits);
  const suggestedImportTag = buildSuggestedWorkspacePackageImportTag(
    input.generatedAt,
    input.existingWorkspaceTags,
  );
  const packageBytes = normalizeWorkspacePackageZipBytes(input.packageBytes, normalizedLimits.maxZipBytes);
  const zipFile = await openWorkspacePackageZipFile(packageBytes);

  let collectedZip: CollectedWorkspacePackageZip;
  try {
    collectedZip = await collectWorkspacePackageZipEntries(zipFile, normalizedLimits);
  } finally {
    if (zipFile.isOpen) {
      zipFile.close();
    }
  }

  const cardsJson = parseWorkspacePackageCardsJsonBytes(collectedZip.cardsJsonBytes);
  assertWorkspacePackageCardCountWithinLimit(cardsJson.cards.length, normalizedLimits.maxCards);
  const tagPlan = planCardImportTags(cardsJson.cards, {
    addImportTag: true,
    importTag: suggestedImportTag,
    removeTags: [],
  });
  const referencedMediaPaths = extractReferencedWorkspacePackageMediaPaths(cardsJson.cards);
  assertReferencedWorkspacePackageMediaFilesExist(referencedMediaPaths, collectedZip.mediaEntriesByPath);

  return {
    sourceKind: "zip",
    packageMetadata: toPackageMetadataPreview(cardsJson),
    cardCount: cardsJson.cards.length,
    tagCounts: tagPlan.sourceTagCounts,
    referencedMediaCount: referencedMediaPaths.length,
    packageMediaFileCount: collectedZip.mediaPaths.length,
    warnings: buildUnsupportedMediaWarnings(referencedMediaPaths),
    defaultOptions: {
      addImportTag: true,
      suggestedImportTag,
      keptTags: tagPlan.keptTags,
      removedTags: tagPlan.removedTags,
    },
  };
}

export async function previewWorkspacePackageZipImport(
  input: WorkspacePackageImportPreviewInput,
): Promise<WorkspacePackageImportPreview> {
  return previewWorkspacePackageZipImportWithLimits(input, defaultImportPreviewLimits);
}
