import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import {
  fromBufferPromise,
  type Entry as ZipEntry,
  type ZipFile,
} from "yauzl";
import { HttpError } from "../shared/errors";
import {
  extractMarkdownPortableMediaPaths,
  validatePortableMediaPath,
  validateUniquePortableMediaPaths,
} from "./markdownMedia";
import {
  parseWorkspacePackageCardsJsonV1,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardsJsonV1,
} from "./types";

export const workspacePackageImportPreviewDefaultMaxZipBytes = 80 * 1024 * 1024;
export const workspacePackageImportPreviewDefaultMaxEntries = 10_001;
export const workspacePackageImportPreviewDefaultMaxCards = 5_000;
export const workspacePackageImportPreviewDefaultMaxMediaFiles = 10_000;
export const workspacePackageImportPreviewDefaultMaxSingleMediaBytes = 16 * 1024 * 1024;
export const workspacePackageImportPreviewDefaultMaxTotalMediaBytes = 64 * 1024 * 1024;

export type WorkspacePackageImportPreviewInput = Readonly<{
  packageBytes: Buffer | Uint8Array;
  generatedAt: string;
  existingWorkspaceTags: ReadonlyArray<string>;
}>;

export type WorkspacePackageImportPreviewLimits = Readonly<{
  maxZipBytes: number;
  maxEntries: number;
  maxCards: number;
  maxMediaFiles: number;
  maxSingleMediaBytes: number;
  maxTotalMediaBytes: number;
}>;

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

type CollectedWorkspacePackageZip = Readonly<{
  cardsJsonBytes: Buffer | null;
  cardsJsonEntryCount: number;
  mediaEntriesByPath: ReadonlyMap<string, ZipEntry>;
  mediaPaths: ReadonlyArray<string>;
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

const defaultImportPreviewLimits: WorkspacePackageImportPreviewLimits = {
  maxZipBytes: workspacePackageImportPreviewDefaultMaxZipBytes,
  maxEntries: workspacePackageImportPreviewDefaultMaxEntries,
  maxCards: workspacePackageImportPreviewDefaultMaxCards,
  maxMediaFiles: workspacePackageImportPreviewDefaultMaxMediaFiles,
  maxSingleMediaBytes: workspacePackageImportPreviewDefaultMaxSingleMediaBytes,
  maxTotalMediaBytes: workspacePackageImportPreviewDefaultMaxTotalMediaBytes,
};

function createImportPreviewInputError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_INPUT_INVALID");
}

function createImportPreviewZipInvalidError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_INVALID");
}

function createImportPreviewCardsJsonMalformedError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_MALFORMED");
}

function createImportPreviewCardsJsonInvalidError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_INVALID");
}

function createImportPreviewTooLargeError(message: string): HttpError {
  return new HttpError(413, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_TOO_LARGE");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    throw createImportPreviewInputError(`${fieldName} must not be empty`);
  }

  return normalizedValue;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const normalizedValue = normalizeNonEmptyText(value, fieldName);
  const parsedValue = new Date(normalizedValue);
  if (Number.isNaN(parsedValue.getTime())) {
    throw createImportPreviewInputError(`${fieldName} must be a valid ISO timestamp`);
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
      throw createImportPreviewInputError(`${fieldName} must not contain duplicates`);
    }

    existingValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  });

  return normalizedValues;
}

function assertPositiveSafeInteger(value: number, fieldName: string): void {
  if (
    Number.isSafeInteger(value) === false
    || value < 1
    || value >= Number.MAX_SAFE_INTEGER
  ) {
    throw createImportPreviewInputError(`${fieldName} must be a positive safe integer`);
  }
}

function normalizePreviewLimits(
  limits: WorkspacePackageImportPreviewLimits,
): WorkspacePackageImportPreviewLimits {
  assertPositiveSafeInteger(limits.maxZipBytes, "limits.maxZipBytes");
  assertPositiveSafeInteger(limits.maxEntries, "limits.maxEntries");
  assertPositiveSafeInteger(limits.maxCards, "limits.maxCards");
  assertPositiveSafeInteger(limits.maxMediaFiles, "limits.maxMediaFiles");
  assertPositiveSafeInteger(limits.maxSingleMediaBytes, "limits.maxSingleMediaBytes");
  assertPositiveSafeInteger(limits.maxTotalMediaBytes, "limits.maxTotalMediaBytes");

  return limits;
}

function normalizePackageBytes(packageBytes: Buffer | Uint8Array, maxZipBytes: number): Buffer {
  const bytes = Buffer.from(packageBytes);
  if (bytes.byteLength > maxZipBytes) {
    throw createImportPreviewTooLargeError(
      `Workspace package ZIP is too large. zipBytes=${bytes.byteLength} maxZipBytes=${maxZipBytes}`,
    );
  }

  return bytes;
}

function assertZipEntryDataCanBeDecoded(entry: ZipEntry, entryPath: string): void {
  if (entry.canDecodeFileData()) {
    return;
  }

  throw createImportPreviewZipInvalidError(
    [
      "Workspace package ZIP entry uses unsupported compression or encryption.",
      `entryPath=${entryPath}`,
      `compressionMethod=${entry.compressionMethod}`,
      `encrypted=${entry.isEncrypted()}`,
    ].join(" "),
  );
}

function normalizeZipEntryPath(entryPath: string): string {
  if (entryPath === "") {
    throw createImportPreviewZipInvalidError("Workspace package ZIP entry path must not be empty");
  }

  if (entryPath.includes("\\") || entryPath.includes("\0")) {
    throw createImportPreviewZipInvalidError(`Workspace package ZIP entry path is unsafe. entryPath=${entryPath}`);
  }

  if (entryPath === "cards.json") {
    return entryPath;
  }

  if (entryPath.startsWith("media/")) {
    try {
      return validatePortableMediaPath(entryPath);
    } catch (error) {
      throw createImportPreviewZipInvalidError(
        `Workspace package ZIP contains unsafe media path. entryPath=${entryPath} reason=${getErrorMessage(error)}`,
      );
    }
  }

  throw createImportPreviewZipInvalidError(
    `Workspace package ZIP contains unsupported entry. entryPath=${entryPath}. Only cards.json and media/** are supported.`,
  );
}

async function openZipFile(bytes: Buffer): Promise<ZipFile> {
  try {
    return await fromBufferPromise(bytes, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
  } catch (error) {
    throw createImportPreviewZipInvalidError(`Workspace package ZIP is invalid. reason=${getErrorMessage(error)}`);
  }
}

async function readZipEntryBytes(
  zipFile: ZipFile,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Buffer> {
  let stream: Readable;
  try {
    stream = await zipFile.openReadStreamPromise(entry);
  } catch (error) {
    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP entry cannot be read. entryPath=${entry.fileName} reason=${getErrorMessage(error)}`,
    );
  }

  const chunks: Array<Buffer> = [];
  let totalBytes = 0;

  try {
    for await (const chunk of stream) {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += chunkBuffer.byteLength;
      if (totalBytes > maxBytes) {
        throw createImportPreviewTooLargeError(
          `Workspace package ZIP entry is too large. entryPath=${entry.fileName} bytes=${totalBytes} maxBytes=${maxBytes}`,
        );
      }

      chunks.push(chunkBuffer);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP entry cannot be read. entryPath=${entry.fileName} reason=${getErrorMessage(error)}`,
    );
  }

  return Buffer.concat(chunks, totalBytes);
}

function assertEntryCountWithinLimit(entryCount: number, maxEntries: number): void {
  if (entryCount <= maxEntries) {
    return;
  }

  throw createImportPreviewTooLargeError(
    `Workspace package ZIP contains too many entries. entryCount=${entryCount} maxEntries=${maxEntries}`,
  );
}

function getReadableChunkByteLength(chunk: unknown): number {
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }

  if (typeof chunk === "string") {
    return Buffer.byteLength(chunk);
  }

  throw new Error("ZIP entry stream emitted an unsupported chunk type");
}

function assertMediaEntryWithinLimit(
  mediaBytes: number,
  entryPath: string,
  maxSingleMediaBytes: number,
): void {
  if (mediaBytes > maxSingleMediaBytes) {
    throw createImportPreviewTooLargeError(
      [
        "Workspace package ZIP media entry is too large.",
        `entryPath=${entryPath}`,
        `mediaBytes=${mediaBytes}`,
        `maxSingleMediaBytes=${maxSingleMediaBytes}`,
      ].join(" "),
    );
  }
}

function assertMediaFileCountWithinLimit(mediaFileCount: number, maxMediaFiles: number): void {
  if (mediaFileCount > maxMediaFiles) {
    throw createImportPreviewTooLargeError(
      `Workspace package ZIP contains too many media files. mediaFileCount=${mediaFileCount} maxMediaFiles=${maxMediaFiles}`,
    );
  }
}

function assertTotalMediaBytesWithinLimit(totalMediaBytes: number, maxTotalMediaBytes: number): void {
  if (Number.isSafeInteger(totalMediaBytes) === false) {
    throw new Error("Workspace package ZIP media byte total must be a safe integer");
  }

  if (totalMediaBytes > maxTotalMediaBytes) {
    throw createImportPreviewTooLargeError(
      [
        "Workspace package ZIP media total is too large.",
        `totalMediaBytes=${totalMediaBytes}`,
        `maxTotalMediaBytes=${maxTotalMediaBytes}`,
      ].join(" "),
    );
  }
}

async function drainMediaZipEntryBytes(
  zipFile: ZipFile,
  entry: ZipEntry,
  entryPath: string,
  currentTotalMediaBytes: number,
  limits: WorkspacePackageImportPreviewLimits,
): Promise<number> {
  let stream: Readable;
  try {
    stream = await zipFile.openReadStreamPromise(entry);
  } catch (error) {
    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP media entry cannot be read. entryPath=${entryPath} reason=${getErrorMessage(error)}`,
    );
  }

  let mediaBytes = 0;
  let totalMediaBytes = currentTotalMediaBytes;

  try {
    for await (const chunk of stream) {
      const chunkByteLength = getReadableChunkByteLength(chunk);
      mediaBytes += chunkByteLength;
      if (Number.isSafeInteger(mediaBytes) === false) {
        throw new Error(`Workspace package ZIP media entry byte count must be a safe integer. entryPath=${entryPath}`);
      }

      assertMediaEntryWithinLimit(mediaBytes, entryPath, limits.maxSingleMediaBytes);
      totalMediaBytes += chunkByteLength;
      assertTotalMediaBytesWithinLimit(totalMediaBytes, limits.maxTotalMediaBytes);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP media entry cannot be read. entryPath=${entryPath} reason=${getErrorMessage(error)}`,
    );
  }

  return totalMediaBytes;
}

async function collectWorkspacePackageZipEntries(
  zipFile: ZipFile,
  limits: WorkspacePackageImportPreviewLimits,
): Promise<CollectedWorkspacePackageZip> {
  assertEntryCountWithinLimit(zipFile.entryCount, limits.maxEntries);

  let cardsJsonBytes: Buffer | null = null;
  let cardsJsonEntryCount = 0;
  const mediaEntriesByPath = new Map<string, ZipEntry>();
  const mediaPaths: Array<string> = [];
  let totalMediaBytes = 0;

  try {
    for await (const entry of zipFile.eachEntry()) {
      const entryPath = normalizeZipEntryPath(entry.fileName);
      assertZipEntryDataCanBeDecoded(entry, entryPath);

      if (entryPath === "cards.json") {
        cardsJsonEntryCount += 1;
        cardsJsonBytes = await readZipEntryBytes(zipFile, entry, limits.maxZipBytes);
        continue;
      }

      assertMediaFileCountWithinLimit(mediaPaths.length + 1, limits.maxMediaFiles);
      totalMediaBytes = await drainMediaZipEntryBytes(zipFile, entry, entryPath, totalMediaBytes, limits);
      mediaEntriesByPath.set(entryPath, entry);
      mediaPaths.push(entryPath);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw createImportPreviewZipInvalidError(`Workspace package ZIP is invalid. reason=${getErrorMessage(error)}`);
  }

  if (cardsJsonEntryCount !== 1) {
    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP must contain exactly one cards.json entry. cardsJsonEntryCount=${cardsJsonEntryCount}`,
    );
  }

  try {
    validateUniquePortableMediaPaths(mediaPaths);
  } catch (error) {
    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP contains duplicate or unsafe media paths. reason=${getErrorMessage(error)}`,
    );
  }

  return {
    cardsJsonBytes,
    cardsJsonEntryCount,
    mediaEntriesByPath,
    mediaPaths,
  };
}

function parseCardsJsonBytes(cardsJsonBytes: Buffer): WorkspacePackageCardsJsonV1 {
  let cardsJsonValue: unknown;
  try {
    cardsJsonValue = JSON.parse(cardsJsonBytes.toString("utf8"));
  } catch (error) {
    throw createImportPreviewCardsJsonMalformedError(
      `Workspace package cards.json is malformed JSON. reason=${getErrorMessage(error)}`,
    );
  }

  try {
    return parseWorkspacePackageCardsJsonV1(cardsJsonValue);
  } catch (error) {
    throw createImportPreviewCardsJsonInvalidError(
      `Workspace package cards.json is invalid. reason=${getErrorMessage(error)}`,
    );
  }
}

function assertCardCountWithinLimit(cardCount: number, maxCards: number): void {
  if (cardCount <= maxCards) {
    return;
  }

  throw createImportPreviewTooLargeError(
    `Workspace package cards.json contains too many cards. cardCount=${cardCount} maxCards=${maxCards}`,
  );
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

function compareTagCounts(
  left: WorkspacePackageImportPreviewTagCount,
  right: WorkspacePackageImportPreviewTagCount,
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

function buildImportPreviewTagCounts(
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>,
): ReadonlyArray<WorkspacePackageImportPreviewTagCount> {
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

function getPackageTagValues(
  tagCounts: ReadonlyArray<WorkspacePackageImportPreviewTagCount>,
): ReadonlyArray<string> {
  return tagCounts.map((tagCount) => tagCount.tag);
}

function extractCardMarkdownPortableMediaPaths(markdown: string): ReadonlyArray<string> {
  try {
    return extractMarkdownPortableMediaPaths(markdown);
  } catch (error) {
    throw createImportPreviewCardsJsonInvalidError(
      `Workspace package cards.json contains unsafe media references. reason=${getErrorMessage(error)}`,
    );
  }
}

function extractReferencedPortableMediaPaths(
  cards: ReadonlyArray<PortableWorkspacePackageCardV1>,
): ReadonlyArray<string> {
  const referencedMediaPaths = new Set<string>();

  for (const card of cards) {
    for (const mediaPath of extractCardMarkdownPortableMediaPaths(card.frontText)) {
      referencedMediaPaths.add(mediaPath);
    }

    for (const mediaPath of extractCardMarkdownPortableMediaPaths(card.backText)) {
      referencedMediaPaths.add(mediaPath);
    }
  }

  try {
    return validateUniquePortableMediaPaths([...referencedMediaPaths]);
  } catch (error) {
    throw createImportPreviewCardsJsonInvalidError(
      `Workspace package cards.json contains duplicate or unsafe media references. reason=${getErrorMessage(error)}`,
    );
  }
}

function assertReferencedMediaFilesExist(
  referencedMediaPaths: ReadonlyArray<string>,
  mediaEntriesByPath: ReadonlyMap<string, ZipEntry>,
): void {
  const missingMediaPaths = referencedMediaPaths.filter((mediaPath) => mediaEntriesByPath.has(mediaPath) === false);
  if (missingMediaPaths.length === 0) {
    return;
  }

  throw createImportPreviewZipInvalidError(
    `Workspace package cards.json references media files missing from ZIP. missingMediaPaths=${missingMediaPaths.join(",")}`,
  );
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
  const normalizedGeneratedAt = normalizeIsoTimestamp(generatedAt, "generatedAt");
  const normalizedExistingTags = normalizeUniqueTextValues(existingWorkspaceTags, "existingWorkspaceTags");
  const existingTags = new Set(normalizedExistingTags);
  const importDate = normalizedGeneratedAt.slice(0, 10);
  let suffix = 0;
  let suggestedImportTag = `import:${importDate}-${suffix}`;

  while (existingTags.has(suggestedImportTag)) {
    suffix += 1;
    suggestedImportTag = `import:${importDate}-${suffix}`;
  }

  return suggestedImportTag;
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
    throw createImportPreviewInputError(
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

function buildDefaultImportOptions(
  tagCounts: ReadonlyArray<WorkspacePackageImportPreviewTagCount>,
  suggestedImportTag: string,
): WorkspacePackageImportDefaultOptions {
  const packageTags = getPackageTagValues(tagCounts);
  const tagPolicy = createDefaultWorkspacePackageImportTagPolicy(packageTags);

  return {
    addImportTag: true,
    suggestedImportTag,
    keptTags: tagPolicy.keptTags,
    removedTags: tagPolicy.removedTags,
  };
}

export async function previewWorkspacePackageZipImportWithLimits(
  input: WorkspacePackageImportPreviewInput,
  limits: WorkspacePackageImportPreviewLimits,
): Promise<WorkspacePackageImportPreview> {
  const normalizedLimits = normalizePreviewLimits(limits);
  const suggestedImportTag = buildSuggestedWorkspacePackageImportTag(
    input.generatedAt,
    input.existingWorkspaceTags,
  );
  const packageBytes = normalizePackageBytes(input.packageBytes, normalizedLimits.maxZipBytes);
  const zipFile = await openZipFile(packageBytes);

  let collectedZip: CollectedWorkspacePackageZip;
  try {
    collectedZip = await collectWorkspacePackageZipEntries(zipFile, normalizedLimits);
  } finally {
    if (zipFile.isOpen) {
      zipFile.close();
    }
  }

  if (collectedZip.cardsJsonBytes === null) {
    throw createImportPreviewZipInvalidError(
      `Workspace package ZIP must contain exactly one cards.json entry. cardsJsonEntryCount=${collectedZip.cardsJsonEntryCount}`,
    );
  }

  const cardsJson = parseCardsJsonBytes(collectedZip.cardsJsonBytes);
  assertCardCountWithinLimit(cardsJson.cards.length, normalizedLimits.maxCards);
  const tagCounts = buildImportPreviewTagCounts(cardsJson.cards);
  const referencedMediaPaths = extractReferencedPortableMediaPaths(cardsJson.cards);
  assertReferencedMediaFilesExist(referencedMediaPaths, collectedZip.mediaEntriesByPath);

  return {
    sourceKind: "zip",
    packageMetadata: toPackageMetadataPreview(cardsJson),
    cardCount: cardsJson.cards.length,
    tagCounts,
    referencedMediaCount: referencedMediaPaths.length,
    packageMediaFileCount: collectedZip.mediaPaths.length,
    warnings: buildUnsupportedMediaWarnings(referencedMediaPaths),
    defaultOptions: buildDefaultImportOptions(
      tagCounts,
      suggestedImportTag,
    ),
  };
}

export async function previewWorkspacePackageZipImport(
  input: WorkspacePackageImportPreviewInput,
): Promise<WorkspacePackageImportPreview> {
  return previewWorkspacePackageZipImportWithLimits(input, defaultImportPreviewLimits);
}
