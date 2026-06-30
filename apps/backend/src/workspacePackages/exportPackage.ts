import { Buffer } from "node:buffer";
import {
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
} from "../database";
import { MEDIA_ASSET_JOIN_CLAUSE } from "../mediaAssets";
import {
  loadMediaAssetObjectBytes,
  type LoadedMediaAssetObjectBytes,
  type LoadMediaAssetObjectBytesInput,
} from "../mediaAssets/storage";
import type { BackendObservationScope } from "../observability/sentry";
import { normalizeCardMetadata } from "../cards/shared";
import { HttpError } from "../shared/errors";
import {
  rewriteMarkdownFcAssetUrlsToSharedPortablePaths,
  validatePortableMediaPath,
} from "./markdownMedia";
import {
  buildAvailableWorkspacePackageExportTagCounts,
  buildWorkspacePackageExportSelectedCardsQuery,
  buildWorkspacePackageExportTagsSelectedForRemoval,
  extractReferencedWorkspacePackageExportMediaAssetIds,
  normalizeWorkspacePackageExportCardSelection,
  normalizeWorkspacePackageExportMetadata,
  normalizeWorkspacePackageExportTagPolicy,
  type WorkspacePackageExportMetadataInput,
  type WorkspacePackageExportSelectedCardRow,
  type WorkspacePackageExportSelectedCardsQuery,
  type WorkspacePackageExportTagPolicyInput,
  type WorkspacePackageExportCardSelection,
} from "./exportPreview";
import {
  toPortableWorkspacePackageCard,
  workspacePackageFormatVersion,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardsJsonV1,
} from "./types";

export const workspacePackageExportPackageDefaultMaxSelectedCards = 5_000;
export const workspacePackageExportPackageDefaultMaxMediaFiles = 10_000;
export const workspacePackageExportPackageDefaultMaxSingleMediaBytes = 16 * 1024 * 1024;
export const workspacePackageExportPackageDefaultMaxTotalMediaBytes = 64 * 1024 * 1024;

export type WorkspacePackageExportPackageInput = Readonly<{
  selection: WorkspacePackageExportCardSelection;
  tagPolicy: WorkspacePackageExportTagPolicyInput;
  packageMetadata: WorkspacePackageExportMetadataInput;
  generatedAt: string;
  observationScope: BackendObservationScope;
}>;

export type WorkspacePackageExportPackageLimits = Readonly<{
  maxSelectedCards: number;
  maxMediaFiles: number;
  maxSingleMediaBytes: number;
  maxTotalMediaBytes: number;
}>;

export type WorkspacePackageExportPackage = Readonly<{
  fileName: "flashcards.zip";
  contentType: "application/zip";
  bytes: Buffer;
}>;

export type WorkspacePackageExportPackageDependencies = Readonly<{
  loadMediaAssetObjectBytesFn: (input: LoadMediaAssetObjectBytesInput) => Promise<LoadedMediaAssetObjectBytes>;
}>;

type WorkspacePackageExportPackageMediaRow = Readonly<{
  media_asset_id: string;
  media_blob_id: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_key: string;
}>;

type WorkspacePackageMediaFile = Readonly<{
  path: string;
  mediaAssetIds: ReadonlyArray<string>;
  row: WorkspacePackageExportPackageMediaRow;
}>;

type LoadedWorkspacePackageMediaFile = Readonly<{
  path: string;
  bytes: Buffer;
}>;

type PreparedWorkspacePackageExport = Readonly<{
  cardsJson: WorkspacePackageCardsJsonV1;
  mediaFiles: ReadonlyArray<WorkspacePackageMediaFile>;
  limits: WorkspacePackageExportPackageLimits;
}>;

type ZipEntry = Readonly<{
  path: string;
  bytes: Buffer;
}>;

type StoredZipCentralDirectoryEntry = Readonly<{
  pathBytes: Buffer;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/iu;
const zipLocalFileHeaderSignature = 0x04034b50;
const zipCentralDirectoryHeaderSignature = 0x02014b50;
const zipEndOfCentralDirectorySignature = 0x06054b50;
const zipVersionNeededToExtract = 20;
const zipStoredCompressionMethod = 0;
const zipDosTimeMidnight = 0;
const zipDosDateJanuaryFirst1980 = 33;
const zipUint16Max = 0xffff;
const zipUint32Max = 0xffffffff;

const packageMediaExtensionByMimeType: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/svg+xml", "svg"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
  ["video/mp4", "mp4"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
]);

const crc32Table = createCrc32Table();

function createPackageInputError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_EXPORT_PACKAGE_INPUT_INVALID");
}

function createPackageSelectionTooLargeError(maxSelectedCards: number): HttpError {
  return new HttpError(
    413,
    `Workspace package export package selection is too large. selectedCardLimit=${maxSelectedCards}`,
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_SELECTION_TOO_LARGE",
  );
}

function createPackageCardNotFoundError(missingCardIds: ReadonlyArray<string>): HttpError {
  return new HttpError(
    404,
    `Workspace package export package selection contains unavailable cards. missingCardIds=${missingCardIds.join(",")}`,
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_CARD_NOT_FOUND",
  );
}

function createPackageMediaAssetUnavailableError(mediaAssetIds: ReadonlyArray<string>): HttpError {
  return new HttpError(
    400,
    `Workspace package export package references unavailable media assets. mediaAssetIds=${mediaAssetIds.join(",")}`,
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_ASSET_UNAVAILABLE",
  );
}

function createPackageMediaAssetIdInvalidError(mediaAssetIds: ReadonlyArray<string>): HttpError {
  return new HttpError(
    400,
    `Workspace package export package references invalid media asset ids. invalidMediaAssetIds=${mediaAssetIds.join(",")}`,
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_ASSET_ID_INVALID",
  );
}

function createPackageSingleMediaTooLargeError(
  mediaAssetId: string,
  sizeBytes: number,
  maxSingleMediaBytes: number,
): HttpError {
  return new HttpError(
    413,
    [
      "Workspace package export package media asset is too large.",
      `mediaAssetId=${mediaAssetId}`,
      `sizeBytes=${sizeBytes}`,
      `maxSingleMediaBytes=${maxSingleMediaBytes}`,
    ].join(" "),
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_SINGLE_MEDIA_TOO_LARGE",
  );
}

function createPackageTotalMediaTooLargeError(
  totalMediaBytes: number,
  maxTotalMediaBytes: number,
): HttpError {
  return new HttpError(
    413,
    [
      "Workspace package export package media total is too large.",
      `totalMediaBytes=${totalMediaBytes}`,
      `maxTotalMediaBytes=${maxTotalMediaBytes}`,
    ].join(" "),
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_TOTAL_MEDIA_TOO_LARGE",
  );
}

function createPackageMediaFileCountTooLargeError(
  mediaFileCount: number,
  maxMediaFiles: number,
): HttpError {
  return new HttpError(
    413,
    [
      "Workspace package export package media file count is too large.",
      `mediaFileCount=${mediaFileCount}`,
      `maxMediaFiles=${maxMediaFiles}`,
    ].join(" "),
    "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_FILE_COUNT_TOO_LARGE",
  );
}

function assertPositiveSafeInteger(value: number, fieldName: string): void {
  if (
    Number.isSafeInteger(value) === false
    || value < 1
    || value >= Number.MAX_SAFE_INTEGER
  ) {
    throw createPackageInputError(`${fieldName} must be a positive safe integer`);
  }
}

function normalizePackageLimits(
  limits: WorkspacePackageExportPackageLimits,
): WorkspacePackageExportPackageLimits {
  assertPositiveSafeInteger(limits.maxSelectedCards, "limits.maxSelectedCards");
  assertPositiveSafeInteger(limits.maxMediaFiles, "limits.maxMediaFiles");
  assertPositiveSafeInteger(limits.maxSingleMediaBytes, "limits.maxSingleMediaBytes");
  assertPositiveSafeInteger(limits.maxTotalMediaBytes, "limits.maxTotalMediaBytes");
  if (limits.maxMediaFiles > zipUint16Max - 1) {
    throw createPackageInputError(`limits.maxMediaFiles must be less than ${zipUint16Max}`);
  }

  return limits;
}

function toSafeNumber(value: string | number, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isSafeInteger(parsedValue) === false || parsedValue < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }

  return parsedValue;
}

function canonicalizePackageUuidValue(value: string, fieldName: string): string {
  if (uuidPattern.test(value) === false) {
    throw createPackageInputError(`${fieldName} must be a UUID value`);
  }

  return value.toLowerCase();
}

function canonicalizeUniquePackageUuidValues(
  values: ReadonlyArray<string>,
  fieldName: string,
): ReadonlyArray<string> {
  const canonicalValues: Array<string> = [];
  const seenValues = new Set<string>();

  values.forEach((value, index) => {
    const canonicalValue = canonicalizePackageUuidValue(value, `${fieldName}[${index}]`);
    if (seenValues.has(canonicalValue)) {
      throw createPackageInputError(`${fieldName} must not contain duplicates`);
    }

    seenValues.add(canonicalValue);
    canonicalValues.push(canonicalValue);
  });

  return canonicalValues;
}

function canonicalizePackageCardSelection(
  selection: WorkspacePackageExportCardSelection,
): WorkspacePackageExportCardSelection {
  if (selection.kind !== "explicitCardIds") {
    return selection;
  }

  return {
    kind: "explicitCardIds",
    cardIds: canonicalizeUniquePackageUuidValues(selection.cardIds, "selection.cardIds"),
  };
}

function canonicalizeReferencedMediaAssetIds(
  mediaAssetIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const invalidMediaAssetIds = mediaAssetIds.filter((mediaAssetId) => uuidPattern.test(mediaAssetId) === false);
  if (invalidMediaAssetIds.length !== 0) {
    throw createPackageMediaAssetIdInvalidError(invalidMediaAssetIds);
  }

  const canonicalMediaAssetIds: Array<string> = [];
  const seenMediaAssetIds = new Set<string>();

  for (const mediaAssetId of mediaAssetIds) {
    const canonicalMediaAssetId = mediaAssetId.toLowerCase();
    if (seenMediaAssetIds.has(canonicalMediaAssetId)) {
      continue;
    }

    seenMediaAssetIds.add(canonicalMediaAssetId);
    canonicalMediaAssetIds.push(canonicalMediaAssetId);
  }

  return canonicalMediaAssetIds;
}

function assertSelectionWithinPackageLimit(
  selectedCardCount: number,
  maxSelectedCards: number,
): void {
  if (selectedCardCount <= maxSelectedCards) {
    return;
  }

  throw createPackageSelectionTooLargeError(maxSelectedCards);
}

function assertExplicitPackageCardsFound(
  rows: ReadonlyArray<WorkspacePackageExportSelectedCardRow>,
  explicitCardIds: ReadonlyArray<string> | null,
): void {
  if (explicitCardIds === null) {
    return;
  }

  const returnedCardIds = new Set(rows.map((row) => row.card_id.toLowerCase()));
  const missingCardIds = explicitCardIds.filter((cardId) => returnedCardIds.has(cardId) === false);
  if (missingCardIds.length === 0) {
    return;
  }

  throw createPackageCardNotFoundError(missingCardIds);
}

async function loadSelectedPackageCardsInExecutor(
  executor: DatabaseExecutor,
  query: WorkspacePackageExportSelectedCardsQuery,
  maxSelectedCards: number,
): Promise<ReadonlyArray<WorkspacePackageExportSelectedCardRow>> {
  assertSelectionWithinPackageLimit(query.explicitCardIds?.length ?? 0, maxSelectedCards);
  const result = await executor.query<WorkspacePackageExportSelectedCardRow>(query.text, query.params);
  assertSelectionWithinPackageLimit(result.rows.length, maxSelectedCards);
  assertExplicitPackageCardsFound(result.rows, query.explicitCardIds);

  return result.rows;
}

function assertValidPackageMediaAssetIds(mediaAssetIds: ReadonlyArray<string>): void {
  const invalidMediaAssetIds = mediaAssetIds.filter((mediaAssetId) => uuidPattern.test(mediaAssetId) === false);
  if (invalidMediaAssetIds.length === 0) {
    return;
  }

  throw createPackageMediaAssetIdInvalidError(invalidMediaAssetIds);
}

function assertReferencedPackageMediaAssetsFound(
  mediaAssetIds: ReadonlyArray<string>,
  rows: ReadonlyArray<WorkspacePackageExportPackageMediaRow>,
): void {
  const returnedMediaAssetIds = new Set(rows.map((row) => row.media_asset_id.toLowerCase()));
  const missingMediaAssetIds = mediaAssetIds.filter((mediaAssetId) => returnedMediaAssetIds.has(mediaAssetId) === false);
  if (missingMediaAssetIds.length === 0) {
    return;
  }

  throw createPackageMediaAssetUnavailableError(missingMediaAssetIds);
}

async function loadReferencedPackageMediaRowsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  mediaAssetIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<WorkspacePackageExportPackageMediaRow>> {
  if (mediaAssetIds.length === 0) {
    return [];
  }

  assertValidPackageMediaAssetIds(mediaAssetIds);
  const result = await executor.query<WorkspacePackageExportPackageMediaRow>(
    [
      "SELECT",
      "media_assets.media_asset_id AS media_asset_id,",
      "media_assets.media_blob_id AS media_blob_id,",
      "media_blobs.mime_type AS mime_type,",
      "media_blobs.size_bytes AS size_bytes,",
      "media_blobs.sha256 AS sha256,",
      "media_blobs.storage_key AS storage_key",
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "AND media_assets.media_asset_id = ANY($2::uuid[])",
      "AND media_assets.deleted_at IS NULL",
      "ORDER BY array_position($2::uuid[], media_assets.media_asset_id)",
    ].join(" "),
    [workspaceId, mediaAssetIds],
  );
  assertReferencedPackageMediaAssetsFound(mediaAssetIds, result.rows);

  return result.rows;
}

function assertValidSha256(sha256: string, mediaAssetId: string): string {
  if (sha256Pattern.test(sha256) === false) {
    throw new Error(`media blob sha256 must be a lowercase or uppercase hex sha256. mediaAssetId=${mediaAssetId}`);
  }

  return sha256.toLowerCase();
}

function getPackageMediaExtension(mimeType: string): string {
  return packageMediaExtensionByMimeType.get(mimeType.toLowerCase()) ?? "bin";
}

function buildPackageMediaPath(row: WorkspacePackageExportPackageMediaRow): string {
  const normalizedSha256 = assertValidSha256(row.sha256, row.media_asset_id);
  const extension = getPackageMediaExtension(row.mime_type);
  return validatePortableMediaPath([
    "media",
    "sha256",
    normalizedSha256.slice(0, 2),
    normalizedSha256.slice(2, 4),
    `${normalizedSha256}.${extension}`,
  ].join("/"));
}

function assertMediaRowsWithinPackageLimits(
  mediaRows: ReadonlyArray<WorkspacePackageExportPackageMediaRow>,
  limits: WorkspacePackageExportPackageLimits,
): void {
  const countedSha256Values = new Set<string>();
  let totalMediaBytes = 0;

  for (const mediaRow of mediaRows) {
    const normalizedSha256 = assertValidSha256(mediaRow.sha256, mediaRow.media_asset_id);
    if (countedSha256Values.has(normalizedSha256)) {
      continue;
    }

    countedSha256Values.add(normalizedSha256);
    const sizeBytes = toSafeNumber(mediaRow.size_bytes, "size_bytes");
    if (sizeBytes > limits.maxSingleMediaBytes) {
      throw createPackageSingleMediaTooLargeError(
        mediaRow.media_asset_id,
        sizeBytes,
        limits.maxSingleMediaBytes,
      );
    }

    totalMediaBytes += sizeBytes;
    if (Number.isSafeInteger(totalMediaBytes) === false) {
      throw new Error("Workspace package export media byte total must be a safe integer");
    }

    if (totalMediaBytes > limits.maxTotalMediaBytes) {
      throw createPackageTotalMediaTooLargeError(totalMediaBytes, limits.maxTotalMediaBytes);
    }
  }
}

function buildPackageMediaFiles(
  mediaRows: ReadonlyArray<WorkspacePackageExportPackageMediaRow>,
): ReadonlyArray<WorkspacePackageMediaFile> {
  const mediaFileBySha256 = new Map<string, WorkspacePackageMediaFile>();

  for (const mediaRow of mediaRows) {
    const normalizedSha256 = assertValidSha256(mediaRow.sha256, mediaRow.media_asset_id);
    const existingMediaFile = mediaFileBySha256.get(normalizedSha256);
    if (existingMediaFile !== undefined) {
      mediaFileBySha256.set(normalizedSha256, {
        ...existingMediaFile,
        mediaAssetIds: [...existingMediaFile.mediaAssetIds, mediaRow.media_asset_id.toLowerCase()],
      });
      continue;
    }

    mediaFileBySha256.set(normalizedSha256, {
      path: buildPackageMediaPath(mediaRow),
      mediaAssetIds: [mediaRow.media_asset_id.toLowerCase()],
      row: mediaRow,
    });
  }

  return [...mediaFileBySha256.values()];
}

function assertMediaFilesWithinPackageLimit(
  mediaFiles: ReadonlyArray<WorkspacePackageMediaFile>,
  maxMediaFiles: number,
): void {
  if (mediaFiles.length <= maxMediaFiles) {
    return;
  }

  throw createPackageMediaFileCountTooLargeError(mediaFiles.length, maxMediaFiles);
}

function buildPortablePathsByAssetId(
  mediaFiles: ReadonlyArray<WorkspacePackageMediaFile>,
): ReadonlyMap<string, string> {
  const portablePathsByAssetId = new Map<string, string>();

  for (const mediaFile of mediaFiles) {
    for (const mediaAssetId of mediaFile.mediaAssetIds) {
      portablePathsByAssetId.set(mediaAssetId, mediaFile.path);
    }
  }

  return portablePathsByAssetId;
}

function applyPackageTagRemoval(
  tags: ReadonlyArray<string>,
  removedTags: ReadonlySet<string>,
): ReadonlyArray<string> {
  return tags.filter((tag) => removedTags.has(tag) === false);
}

function buildPortablePackageCards(
  cards: ReadonlyArray<WorkspacePackageExportSelectedCardRow>,
  removedTags: ReadonlySet<string>,
  portablePathsByAssetId: ReadonlyMap<string, string>,
): ReadonlyArray<PortableWorkspacePackageCardV1> {
  const resolvePortablePath = (assetId: string): string => {
    const portablePath = portablePathsByAssetId.get(assetId.toLowerCase());
    if (portablePath === undefined) {
      throw new Error(`Missing portable media path for fcasset id: ${assetId}`);
    }

    return portablePath;
  };

  return cards.map((card) => toPortableWorkspacePackageCard({
    frontText: rewriteMarkdownFcAssetUrlsToSharedPortablePaths(card.front_text, resolvePortablePath),
    backText: rewriteMarkdownFcAssetUrlsToSharedPortablePaths(card.back_text, resolvePortablePath),
    tags: applyPackageTagRemoval(card.tags, removedTags),
    cardType: card.card_type,
    metadata: normalizeCardMetadata(card.metadata),
  }));
}

async function loadWorkspacePackageMediaFile(
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
  limits: WorkspacePackageExportPackageLimits,
  dependencies: WorkspacePackageExportPackageDependencies,
  mediaFile: WorkspacePackageMediaFile,
): Promise<LoadedWorkspacePackageMediaFile> {
  const mediaRow = mediaFile.row;
  const loadedBytes = await dependencies.loadMediaAssetObjectBytesFn({
    workspaceId,
    mediaAssetId: mediaRow.media_asset_id,
    storageKey: mediaRow.storage_key,
    mimeType: mediaRow.mime_type,
    sizeBytes: toSafeNumber(mediaRow.size_bytes, "size_bytes"),
    sha256: assertValidSha256(mediaRow.sha256, mediaRow.media_asset_id),
    maxByteSize: limits.maxSingleMediaBytes,
    observationScope: input.observationScope,
  });

  return {
    path: mediaFile.path,
    bytes: loadedBytes.bytes,
  };
}

async function loadWorkspacePackageMediaFiles(
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
  limits: WorkspacePackageExportPackageLimits,
  dependencies: WorkspacePackageExportPackageDependencies,
  mediaFiles: ReadonlyArray<WorkspacePackageMediaFile>,
): Promise<ReadonlyArray<LoadedWorkspacePackageMediaFile>> {
  const loadedMediaFiles: Array<LoadedWorkspacePackageMediaFile> = [];

  for (const mediaFile of mediaFiles) {
    loadedMediaFiles.push(await loadWorkspacePackageMediaFile(
      workspaceId,
      input,
      limits,
      dependencies,
      mediaFile,
    ));
  }

  return loadedMediaFiles;
}

function createPackageCardsJsonBuffer(cardsJson: WorkspacePackageCardsJsonV1): Buffer {
  return Buffer.from(`${JSON.stringify(cardsJson, null, 2)}\n`, "utf8");
}

function assertZipEntryPath(path: string): void {
  validatePortableMediaPath(path === "cards.json" ? "media/cards.json" : path);
  if (path.includes("\\") || path.startsWith("/") || path.includes("\0")) {
    throw new Error(`ZIP entry path is unsafe: ${path}`);
  }
}

function assertZipEntrySize(value: number, fieldName: string): void {
  if (Number.isSafeInteger(value) === false || value < 0 || value > zipUint32Max) {
    throw new Error(`${fieldName} must fit in ZIP uint32`);
  }
}

function assertZipEntryCount(entryCount: number): void {
  if (entryCount > zipUint16Max) {
    throw new Error(`Workspace package ZIP has too many entries: ${entryCount}`);
  }
}

function createCrc32Table(): ReadonlyArray<number> {
  const table: Array<number> = [];

  for (let tableIndex = 0; tableIndex < 256; tableIndex += 1) {
    let crc = tableIndex;
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }

    table.push(crc >>> 0);
  }

  return table;
}

function calculateCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crc32Table[(crc ^ byte) & 0xff] ?? 0);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createLocalFileHeader(pathBytes: Buffer, bytes: Buffer, crc32: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(zipLocalFileHeaderSignature, 0);
  header.writeUInt16LE(zipVersionNeededToExtract, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(zipStoredCompressionMethod, 8);
  header.writeUInt16LE(zipDosTimeMidnight, 10);
  header.writeUInt16LE(zipDosDateJanuaryFirst1980, 12);
  header.writeUInt32LE(crc32, 14);
  header.writeUInt32LE(bytes.byteLength, 18);
  header.writeUInt32LE(bytes.byteLength, 22);
  header.writeUInt16LE(pathBytes.byteLength, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, pathBytes]);
}

function createCentralDirectoryHeader(entry: StoredZipCentralDirectoryEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(zipCentralDirectoryHeaderSignature, 0);
  header.writeUInt16LE(zipVersionNeededToExtract, 4);
  header.writeUInt16LE(zipVersionNeededToExtract, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(zipStoredCompressionMethod, 10);
  header.writeUInt16LE(zipDosTimeMidnight, 12);
  header.writeUInt16LE(zipDosDateJanuaryFirst1980, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.pathBytes.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);

  return Buffer.concat([header, entry.pathBytes]);
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(zipEndOfCentralDirectorySignature, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);

  return header;
}

function createStoredZip(entries: ReadonlyArray<ZipEntry>): Buffer {
  assertZipEntryCount(entries.length);
  const localFileParts: Array<Buffer> = [];
  const centralDirectoryEntries: Array<StoredZipCentralDirectoryEntry> = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    assertZipEntryPath(entry.path);
    const pathBytes = Buffer.from(entry.path, "utf8");
    assertZipEntrySize(pathBytes.byteLength, "ZIP entry path byte length");
    assertZipEntrySize(entry.bytes.byteLength, "ZIP entry byte length");

    const crc32 = calculateCrc32(entry.bytes);
    const localFileHeader = createLocalFileHeader(pathBytes, entry.bytes, crc32);
    localFileParts.push(localFileHeader, entry.bytes);
    centralDirectoryEntries.push({
      pathBytes,
      crc32,
      compressedSize: entry.bytes.byteLength,
      uncompressedSize: entry.bytes.byteLength,
      localHeaderOffset,
    });
    localHeaderOffset += localFileHeader.byteLength + entry.bytes.byteLength;
    assertZipEntrySize(localHeaderOffset, "ZIP local file section length");
  }

  const centralDirectoryOffset = localHeaderOffset;
  const centralDirectoryParts = centralDirectoryEntries.map(createCentralDirectoryHeader);
  const centralDirectorySize = centralDirectoryParts.reduce((totalSize, part) => totalSize + part.byteLength, 0);
  assertZipEntrySize(centralDirectorySize, "ZIP central directory size");
  assertZipEntrySize(centralDirectoryOffset, "ZIP central directory offset");

  return Buffer.concat([
    ...localFileParts,
    ...centralDirectoryParts,
    createEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset),
  ]);
}

export async function exportWorkspacePackageInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
  limits: WorkspacePackageExportPackageLimits,
  dependencies: WorkspacePackageExportPackageDependencies,
): Promise<WorkspacePackageExportPackage> {
  const preparedExport = await prepareWorkspacePackageExportInExecutor(
    executor,
    workspaceId,
    input,
    limits,
  );

  return assembleWorkspacePackageExport(workspaceId, input, dependencies, preparedExport);
}

async function prepareWorkspacePackageExportInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
  limits: WorkspacePackageExportPackageLimits,
): Promise<PreparedWorkspacePackageExport> {
  const normalizedLimits = normalizePackageLimits(limits);
  const normalizedSelection = canonicalizePackageCardSelection(
    normalizeWorkspacePackageExportCardSelection(input.selection),
  );
  const normalizedTagPolicy = normalizeWorkspacePackageExportTagPolicy(input.tagPolicy);
  const packageMetadata = normalizeWorkspacePackageExportMetadata(input.packageMetadata, input.generatedAt);
  const selectedCardsQuery = buildWorkspacePackageExportSelectedCardsQuery(
    workspaceId,
    normalizedSelection,
    normalizedLimits.maxSelectedCards,
  );
  const selectedCards = await loadSelectedPackageCardsInExecutor(
    executor,
    selectedCardsQuery,
    normalizedLimits.maxSelectedCards,
  );
  const availableTagCounts = buildAvailableWorkspacePackageExportTagCounts(selectedCards);
  const tagsSelectedForRemoval = buildWorkspacePackageExportTagsSelectedForRemoval(
    availableTagCounts,
    normalizedTagPolicy,
  );
  const referencedMediaAssetIds = canonicalizeReferencedMediaAssetIds(
    extractReferencedWorkspacePackageExportMediaAssetIds(selectedCards),
  );
  const mediaRows = await loadReferencedPackageMediaRowsInExecutor(executor, workspaceId, referencedMediaAssetIds);
  assertMediaRowsWithinPackageLimits(mediaRows, normalizedLimits);
  const mediaFiles = buildPackageMediaFiles(mediaRows);
  assertMediaFilesWithinPackageLimit(mediaFiles, normalizedLimits.maxMediaFiles);
  const portablePathsByAssetId = buildPortablePathsByAssetId(mediaFiles);
  const packageCards = buildPortablePackageCards(selectedCards, new Set(
    tagsSelectedForRemoval.map((tagCount) => tagCount.tag),
  ), portablePathsByAssetId);
  const cardsJson: WorkspacePackageCardsJsonV1 = {
    formatVersion: workspacePackageFormatVersion,
    ...packageMetadata,
    cards: packageCards,
  };

  return {
    cardsJson,
    mediaFiles,
    limits: normalizedLimits,
  };
}

async function assembleWorkspacePackageExport(
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
  dependencies: WorkspacePackageExportPackageDependencies,
  preparedExport: PreparedWorkspacePackageExport,
): Promise<WorkspacePackageExportPackage> {
  const loadedMediaFiles = await loadWorkspacePackageMediaFiles(
    workspaceId,
    input,
    preparedExport.limits,
    dependencies,
    preparedExport.mediaFiles,
  );
  const zipEntries: ReadonlyArray<ZipEntry> = [
    {
      path: "cards.json",
      bytes: createPackageCardsJsonBuffer(preparedExport.cardsJson),
    },
    ...loadedMediaFiles.map((mediaFile) => ({
      path: mediaFile.path,
      bytes: mediaFile.bytes,
    })),
  ];

  return {
    fileName: "flashcards.zip",
    contentType: "application/zip",
    bytes: createStoredZip(zipEntries),
  };
}

export async function exportWorkspacePackage(
  userId: string,
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
): Promise<WorkspacePackageExportPackage> {
  const limits: WorkspacePackageExportPackageLimits = {
    maxSelectedCards: workspacePackageExportPackageDefaultMaxSelectedCards,
    maxMediaFiles: workspacePackageExportPackageDefaultMaxMediaFiles,
    maxSingleMediaBytes: workspacePackageExportPackageDefaultMaxSingleMediaBytes,
    maxTotalMediaBytes: workspacePackageExportPackageDefaultMaxTotalMediaBytes,
  };
  const dependencies: WorkspacePackageExportPackageDependencies = {
    loadMediaAssetObjectBytesFn: loadMediaAssetObjectBytes,
  };
  const preparedExport = await transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => (
    prepareWorkspacePackageExportInExecutor(
      executor,
      workspaceId,
      input,
      limits,
    )
  ));

  return assembleWorkspacePackageExport(workspaceId, input, dependencies, preparedExport);
}
