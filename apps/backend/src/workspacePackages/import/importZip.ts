import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import {
  fromBufferPromise,
  type Entry as ZipEntry,
  type ZipFile,
} from "yauzl";
import { HttpError } from "../../shared/errors";
import {
  extractMarkdownPortableMediaPaths,
  validatePortableMediaPath,
  validateUniquePortableMediaPaths,
} from "../markdownMedia";
import {
  parseWorkspacePackageCardsJsonV1,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardsJsonV1,
} from "../types";

export const workspacePackageImportZipDefaultMaxZipBytes = 80 * 1024 * 1024;
export const workspacePackageImportZipDefaultMaxEntries = 10_001;
export const workspacePackageImportZipDefaultMaxCards = 5_000;
export const workspacePackageImportZipDefaultMaxMediaFiles = 10_000;
export const workspacePackageImportZipDefaultMaxSingleMediaBytes = 16 * 1024 * 1024;
export const workspacePackageImportZipDefaultMaxTotalMediaBytes = 64 * 1024 * 1024;

export type WorkspacePackageImportZipLimits = Readonly<{
  maxZipBytes: number;
  maxEntries: number;
  maxCards: number;
  maxMediaFiles: number;
  maxSingleMediaBytes: number;
  maxTotalMediaBytes: number;
}>;

export type CollectedWorkspacePackageZip = Readonly<{
  cardsJsonBytes: Buffer;
  mediaEntriesByPath: ReadonlyMap<string, ZipEntry>;
  mediaPaths: ReadonlyArray<string>;
}>;

export const defaultWorkspacePackageImportZipLimits: WorkspacePackageImportZipLimits = {
  maxZipBytes: workspacePackageImportZipDefaultMaxZipBytes,
  maxEntries: workspacePackageImportZipDefaultMaxEntries,
  maxCards: workspacePackageImportZipDefaultMaxCards,
  maxMediaFiles: workspacePackageImportZipDefaultMaxMediaFiles,
  maxSingleMediaBytes: workspacePackageImportZipDefaultMaxSingleMediaBytes,
  maxTotalMediaBytes: workspacePackageImportZipDefaultMaxTotalMediaBytes,
};

export function createWorkspacePackageImportInputError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_INPUT_INVALID");
}

function createWorkspacePackageImportZipInvalidError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_INVALID");
}

function createWorkspacePackageImportCardsJsonMalformedError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_MALFORMED");
}

function createWorkspacePackageImportCardsJsonInvalidError(message: string): HttpError {
  return new HttpError(400, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_INVALID");
}

function createWorkspacePackageImportTooLargeError(message: string): HttpError {
  return new HttpError(413, message, "WORKSPACE_PACKAGE_IMPORT_PREVIEW_TOO_LARGE");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPositiveSafeInteger(value: number, fieldName: string): void {
  if (
    Number.isSafeInteger(value) === false
    || value < 1
    || value >= Number.MAX_SAFE_INTEGER
  ) {
    throw createWorkspacePackageImportInputError(`${fieldName} must be a positive safe integer`);
  }
}

export function normalizeWorkspacePackageImportZipLimits(
  limits: WorkspacePackageImportZipLimits,
): WorkspacePackageImportZipLimits {
  assertPositiveSafeInteger(limits.maxZipBytes, "limits.maxZipBytes");
  assertPositiveSafeInteger(limits.maxEntries, "limits.maxEntries");
  assertPositiveSafeInteger(limits.maxCards, "limits.maxCards");
  assertPositiveSafeInteger(limits.maxMediaFiles, "limits.maxMediaFiles");
  assertPositiveSafeInteger(limits.maxSingleMediaBytes, "limits.maxSingleMediaBytes");
  assertPositiveSafeInteger(limits.maxTotalMediaBytes, "limits.maxTotalMediaBytes");

  return limits;
}

export function normalizeWorkspacePackageZipBytes(
  packageBytes: Buffer | Uint8Array,
  maxZipBytes: number,
): Buffer {
  const bytes = Buffer.from(packageBytes);
  if (bytes.byteLength > maxZipBytes) {
    throw createWorkspacePackageImportTooLargeError(
      `Workspace package ZIP is too large. zipBytes=${bytes.byteLength} maxZipBytes=${maxZipBytes}`,
    );
  }

  return bytes;
}

function assertZipEntryDataCanBeDecoded(entry: ZipEntry, entryPath: string): void {
  if (entry.canDecodeFileData()) {
    return;
  }

  throw createWorkspacePackageImportZipInvalidError(
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
    throw createWorkspacePackageImportZipInvalidError("Workspace package ZIP entry path must not be empty");
  }

  if (entryPath.includes("\\") || entryPath.includes("\0")) {
    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP entry path is unsafe. entryPath=${entryPath}`,
    );
  }

  if (entryPath === "cards.json") {
    return entryPath;
  }

  if (entryPath.startsWith("media/")) {
    try {
      return validatePortableMediaPath(entryPath);
    } catch (error) {
      throw createWorkspacePackageImportZipInvalidError(
        `Workspace package ZIP contains unsafe media path. entryPath=${entryPath} reason=${getErrorMessage(error)}`,
      );
    }
  }

  throw createWorkspacePackageImportZipInvalidError(
    `Workspace package ZIP contains unsupported entry. entryPath=${entryPath}. Only cards.json and media/** are supported.`,
  );
}

export async function openWorkspacePackageZipFile(bytes: Buffer): Promise<ZipFile> {
  try {
    return await fromBufferPromise(bytes, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
  } catch (error) {
    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP is invalid. reason=${getErrorMessage(error)}`,
    );
  }
}

export async function readWorkspacePackageZipEntryBytes(
  zipFile: ZipFile,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Buffer> {
  let stream: Readable;
  try {
    stream = await zipFile.openReadStreamPromise(entry);
  } catch (error) {
    throw createWorkspacePackageImportZipInvalidError(
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
        throw createWorkspacePackageImportTooLargeError(
          `Workspace package ZIP entry is too large. entryPath=${entry.fileName} bytes=${totalBytes} maxBytes=${maxBytes}`,
        );
      }

      chunks.push(chunkBuffer);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP entry cannot be read. entryPath=${entry.fileName} reason=${getErrorMessage(error)}`,
    );
  }

  return Buffer.concat(chunks, totalBytes);
}

function assertEntryCountWithinLimit(entryCount: number, maxEntries: number): void {
  if (entryCount <= maxEntries) {
    return;
  }

  throw createWorkspacePackageImportTooLargeError(
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
    throw createWorkspacePackageImportTooLargeError(
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
    throw createWorkspacePackageImportTooLargeError(
      `Workspace package ZIP contains too many media files. mediaFileCount=${mediaFileCount} maxMediaFiles=${maxMediaFiles}`,
    );
  }
}

function assertTotalMediaBytesWithinLimit(totalMediaBytes: number, maxTotalMediaBytes: number): void {
  if (Number.isSafeInteger(totalMediaBytes) === false) {
    throw new Error("Workspace package ZIP media byte total must be a safe integer");
  }

  if (totalMediaBytes > maxTotalMediaBytes) {
    throw createWorkspacePackageImportTooLargeError(
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
  limits: WorkspacePackageImportZipLimits,
): Promise<number> {
  let stream: Readable;
  try {
    stream = await zipFile.openReadStreamPromise(entry);
  } catch (error) {
    throw createWorkspacePackageImportZipInvalidError(
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

    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP media entry cannot be read. entryPath=${entryPath} reason=${getErrorMessage(error)}`,
    );
  }

  return totalMediaBytes;
}

export async function collectWorkspacePackageZipEntries(
  zipFile: ZipFile,
  limits: WorkspacePackageImportZipLimits,
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
        cardsJsonBytes = await readWorkspacePackageZipEntryBytes(zipFile, entry, limits.maxZipBytes);
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

    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP is invalid. reason=${getErrorMessage(error)}`,
    );
  }

  if (cardsJsonEntryCount !== 1 || cardsJsonBytes === null) {
    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP must contain exactly one cards.json entry. cardsJsonEntryCount=${cardsJsonEntryCount}`,
    );
  }

  try {
    validateUniquePortableMediaPaths(mediaPaths);
  } catch (error) {
    throw createWorkspacePackageImportZipInvalidError(
      `Workspace package ZIP contains duplicate or unsafe media paths. reason=${getErrorMessage(error)}`,
    );
  }

  return {
    cardsJsonBytes,
    mediaEntriesByPath,
    mediaPaths,
  };
}

export function parseWorkspacePackageCardsJsonBytes(cardsJsonBytes: Buffer): WorkspacePackageCardsJsonV1 {
  let cardsJsonValue: unknown;
  try {
    cardsJsonValue = JSON.parse(cardsJsonBytes.toString("utf8"));
  } catch (error) {
    throw createWorkspacePackageImportCardsJsonMalformedError(
      `Workspace package cards.json is malformed JSON. reason=${getErrorMessage(error)}`,
    );
  }

  try {
    return parseWorkspacePackageCardsJsonV1(cardsJsonValue);
  } catch (error) {
    throw createWorkspacePackageImportCardsJsonInvalidError(
      `Workspace package cards.json is invalid. reason=${getErrorMessage(error)}`,
    );
  }
}

export function assertWorkspacePackageCardCountWithinLimit(cardCount: number, maxCards: number): void {
  if (cardCount <= maxCards) {
    return;
  }

  throw createWorkspacePackageImportTooLargeError(
    `Workspace package cards.json contains too many cards. cardCount=${cardCount} maxCards=${maxCards}`,
  );
}

function extractCardMarkdownPortableMediaPaths(markdown: string): ReadonlyArray<string> {
  try {
    return extractMarkdownPortableMediaPaths(markdown);
  } catch (error) {
    throw createWorkspacePackageImportCardsJsonInvalidError(
      `Workspace package cards.json contains unsafe media references. reason=${getErrorMessage(error)}`,
    );
  }
}

export function extractReferencedWorkspacePackageMediaPaths(
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
    throw createWorkspacePackageImportCardsJsonInvalidError(
      `Workspace package cards.json contains duplicate or unsafe media references. reason=${getErrorMessage(error)}`,
    );
  }
}

export function assertReferencedWorkspacePackageMediaFilesExist(
  referencedMediaPaths: ReadonlyArray<string>,
  mediaEntriesByPath: ReadonlyMap<string, ZipEntry>,
): void {
  const missingMediaPaths = referencedMediaPaths.filter((mediaPath) => mediaEntriesByPath.has(mediaPath) === false);
  if (missingMediaPaths.length === 0) {
    return;
  }

  throw createWorkspacePackageImportZipInvalidError(
    `Workspace package cards.json references media files missing from ZIP. missingMediaPaths=${missingMediaPaths.join(",")}`,
  );
}
