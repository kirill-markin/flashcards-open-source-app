import { Buffer } from "node:buffer";
import type { Entry as ZipEntry, ZipFile } from "yauzl";
import {
  assertReferencedWorkspacePackageMediaFilesExist,
  assertWorkspacePackageCardCountWithinLimit,
  collectWorkspacePackageZipEntries,
  defaultWorkspacePackageImportZipLimits,
  extractReferencedWorkspacePackageMediaPaths,
  normalizeWorkspacePackageImportZipLimits,
  normalizeWorkspacePackageZipBytes,
  openWorkspacePackageZipFile,
  parseWorkspacePackageCardsJsonBytes,
  readWorkspacePackageZipEntryBytes,
  type CollectedWorkspacePackageZip,
  type WorkspacePackageImportZipLimits,
} from "./importZip";
import type { WorkspacePackageCardsJsonV1 } from "./types";

export type WorkspacePackageImportReferencedMediaInput = Readonly<{
  packageBytes: Buffer | Uint8Array;
}>;

export type WorkspacePackageImportReferencedMediaLimits = WorkspacePackageImportZipLimits;

export type WorkspacePackageImportReferencedMediaFile = Readonly<{
  portablePath: string;
  bytes: Buffer;
  sizeBytes: number;
}>;

export type WorkspacePackageImportReferencedMediaLoadResult = Readonly<{
  cardsJson: WorkspacePackageCardsJsonV1;
  referencedMediaFiles: ReadonlyArray<WorkspacePackageImportReferencedMediaFile>;
  referencedMediaFilesByPath: ReadonlyMap<string, WorkspacePackageImportReferencedMediaFile>;
}>;

const defaultImportMediaLimits: WorkspacePackageImportReferencedMediaLimits = defaultWorkspacePackageImportZipLimits;

function getRequiredReferencedMediaEntry(
  portablePath: string,
  mediaEntriesByPath: ReadonlyMap<string, ZipEntry>,
): ZipEntry {
  const mediaEntry = mediaEntriesByPath.get(portablePath);
  if (mediaEntry === undefined) {
    throw new Error(`Referenced workspace package media entry was not found after validation. portablePath=${portablePath}`);
  }

  return mediaEntry;
}

async function readReferencedMediaFile(
  zipFile: ZipFile,
  portablePath: string,
  mediaEntry: ZipEntry,
  limits: WorkspacePackageImportReferencedMediaLimits,
): Promise<WorkspacePackageImportReferencedMediaFile> {
  const bytes = await readWorkspacePackageZipEntryBytes(
    zipFile,
    mediaEntry,
    limits.maxSingleMediaBytes,
  );

  return {
    portablePath,
    bytes,
    sizeBytes: bytes.byteLength,
  };
}

async function readReferencedMediaFiles(
  zipFile: ZipFile,
  referencedMediaPaths: ReadonlyArray<string>,
  collectedZip: CollectedWorkspacePackageZip,
  limits: WorkspacePackageImportReferencedMediaLimits,
): Promise<ReadonlyArray<WorkspacePackageImportReferencedMediaFile>> {
  const referencedMediaFiles: Array<WorkspacePackageImportReferencedMediaFile> = [];

  for (const portablePath of referencedMediaPaths) {
    const mediaEntry = getRequiredReferencedMediaEntry(portablePath, collectedZip.mediaEntriesByPath);
    const mediaFile = await readReferencedMediaFile(zipFile, portablePath, mediaEntry, limits);
    referencedMediaFiles.push(mediaFile);
  }

  return referencedMediaFiles;
}

function buildReferencedMediaFilesByPath(
  referencedMediaFiles: ReadonlyArray<WorkspacePackageImportReferencedMediaFile>,
): ReadonlyMap<string, WorkspacePackageImportReferencedMediaFile> {
  return new Map(referencedMediaFiles.map((mediaFile) => [mediaFile.portablePath, mediaFile]));
}

function buildImportReferencedMediaLoadResult(
  cardsJson: WorkspacePackageCardsJsonV1,
  referencedMediaFiles: ReadonlyArray<WorkspacePackageImportReferencedMediaFile>,
): WorkspacePackageImportReferencedMediaLoadResult {
  return {
    cardsJson,
    referencedMediaFiles,
    referencedMediaFilesByPath: buildReferencedMediaFilesByPath(referencedMediaFiles),
  };
}

export async function loadWorkspacePackageImportReferencedMediaWithLimits(
  input: WorkspacePackageImportReferencedMediaInput,
  limits: WorkspacePackageImportReferencedMediaLimits,
): Promise<WorkspacePackageImportReferencedMediaLoadResult> {
  const normalizedLimits = normalizeWorkspacePackageImportZipLimits(limits);
  const packageBytes = normalizeWorkspacePackageZipBytes(input.packageBytes, normalizedLimits.maxZipBytes);
  const zipFile = await openWorkspacePackageZipFile(packageBytes);

  try {
    const collectedZip = await collectWorkspacePackageZipEntries(zipFile, normalizedLimits);
    const cardsJson = parseWorkspacePackageCardsJsonBytes(collectedZip.cardsJsonBytes);
    assertWorkspacePackageCardCountWithinLimit(cardsJson.cards.length, normalizedLimits.maxCards);
    const referencedMediaPaths = extractReferencedWorkspacePackageMediaPaths(cardsJson.cards);
    assertReferencedWorkspacePackageMediaFilesExist(referencedMediaPaths, collectedZip.mediaEntriesByPath);
    const referencedMediaFiles = await readReferencedMediaFiles(
      zipFile,
      referencedMediaPaths,
      collectedZip,
      normalizedLimits,
    );

    return buildImportReferencedMediaLoadResult(cardsJson, referencedMediaFiles);
  } finally {
    if (zipFile.isOpen) {
      zipFile.close();
    }
  }
}

export async function loadWorkspacePackageImportReferencedMedia(
  input: WorkspacePackageImportReferencedMediaInput,
): Promise<WorkspacePackageImportReferencedMediaLoadResult> {
  return loadWorkspacePackageImportReferencedMediaWithLimits(input, defaultImportMediaLimits);
}
