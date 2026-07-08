import { randomUUID } from "node:crypto";
import {
  ingestImageMediaAsset,
  type ImageMediaAssetIngestionInput,
  type ImageMediaAssetIngestionResult,
} from "../../../mediaAssets/ingestion";
import type { MediaAsset } from "../../../mediaAssets/types";
import type { BackendObservationScope } from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import { validateUniquePortableMediaPaths } from "../../markdownMedia";
import type { WorkspacePackageImportReferencedMediaFile } from "./importMedia";

export type WorkspacePackageImportMediaAssetIngestionInput = Readonly<{
  userId: string;
  workspaceId: string;
  referencedMediaFiles: ReadonlyArray<WorkspacePackageImportReferencedMediaFile>;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
  observationScope: BackendObservationScope;
}>;

export type WorkspacePackageImportedMediaAsset = Readonly<{
  portablePath: string;
  mediaAsset: MediaAsset;
  applied: boolean;
}>;

export type WorkspacePackageImportMediaAssetIngestionResult = Readonly<{
  mediaAssets: ReadonlyArray<WorkspacePackageImportedMediaAsset>;
  mediaAssetIdsByPortablePath: ReadonlyMap<string, string>;
}>;

export type WorkspacePackageImportMediaAssetIngestionDependencies = Readonly<{
  randomUuidFn: () => string;
  ingestImageMediaAssetFn: (input: ImageMediaAssetIngestionInput) => Promise<ImageMediaAssetIngestionResult>;
}>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createMediaAssetIngestionError(error: unknown, portablePath: string): Error {
  const message = `Workspace package import media asset ingestion failed for portablePath=${portablePath}. reason=${getErrorMessage(error)}`;
  if (error instanceof HttpError) {
    return new HttpError(
      error.statusCode,
      message,
      error.code ?? undefined,
      error.details ?? undefined,
    );
  }

  return new Error(message);
}

function assertReferencedMediaFilesHaveUniquePortablePaths(
  referencedMediaFiles: ReadonlyArray<WorkspacePackageImportReferencedMediaFile>,
): void {
  try {
    validateUniquePortableMediaPaths(referencedMediaFiles.map((mediaFile) => mediaFile.portablePath));
  } catch (error) {
    throw new Error(
      `Invalid workspace package import media asset input: referencedMediaFiles contain duplicate or invalid portable paths. reason=${getErrorMessage(error)}`,
    );
  }
}

function buildMediaImportLastOperationId(operationIdPrefix: string, mediaFileIndex: number): string {
  return `${operationIdPrefix}:media:${mediaFileIndex}`;
}

function buildImageMediaAssetIngestionInput(
  input: WorkspacePackageImportMediaAssetIngestionInput,
  mediaFile: WorkspacePackageImportReferencedMediaFile,
  mediaFileIndex: number,
  mediaAssetId: string,
): ImageMediaAssetIngestionInput {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    metadata: {
      mediaAssetId,
      sourceUrl: null,
      createdAt: input.createdAt,
      clientUpdatedAt: input.clientUpdatedAt,
      lastModifiedByReplicaId: input.lastModifiedByReplicaId,
      lastOperationId: buildMediaImportLastOperationId(input.operationIdPrefix, mediaFileIndex),
    },
    imageBytes: mediaFile.bytes,
    observationScope: input.observationScope,
  };
}

function buildImportMediaAssetIngestionResult(
  mediaAssets: ReadonlyArray<WorkspacePackageImportedMediaAsset>,
): WorkspacePackageImportMediaAssetIngestionResult {
  return {
    mediaAssets,
    mediaAssetIdsByPortablePath: new Map(
      mediaAssets.map((importedMediaAsset) => [
        importedMediaAsset.portablePath,
        importedMediaAsset.mediaAsset.mediaAssetId,
      ]),
    ),
  };
}

export async function ingestWorkspacePackageImportMediaAssetsWithDependencies(
  input: WorkspacePackageImportMediaAssetIngestionInput,
  dependencies: WorkspacePackageImportMediaAssetIngestionDependencies,
): Promise<WorkspacePackageImportMediaAssetIngestionResult> {
  assertReferencedMediaFilesHaveUniquePortablePaths(input.referencedMediaFiles);

  const importedMediaAssets: Array<WorkspacePackageImportedMediaAsset> = [];
  for (const [mediaFileIndex, mediaFile] of input.referencedMediaFiles.entries()) {
    const mediaAssetId = dependencies.randomUuidFn();

    try {
      const result = await dependencies.ingestImageMediaAssetFn(
        buildImageMediaAssetIngestionInput(input, mediaFile, mediaFileIndex, mediaAssetId),
      );
      importedMediaAssets.push({
        portablePath: mediaFile.portablePath,
        mediaAsset: result.mediaAsset,
        applied: result.applied,
      });
    } catch (error) {
      throw createMediaAssetIngestionError(error, mediaFile.portablePath);
    }
  }

  return buildImportMediaAssetIngestionResult(importedMediaAssets);
}

export async function ingestWorkspacePackageImportMediaAssets(
  input: WorkspacePackageImportMediaAssetIngestionInput,
): Promise<WorkspacePackageImportMediaAssetIngestionResult> {
  return ingestWorkspacePackageImportMediaAssetsWithDependencies(input, {
    randomUuidFn: randomUUID,
    ingestImageMediaAssetFn: ingestImageMediaAsset,
  });
}
