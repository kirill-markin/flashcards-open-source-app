import { createHash } from "node:crypto";
import {
  createImageNormalizedMediaAssetForWorkspace,
  loadReusableImageMediaBlobForWorkspace,
} from "..";
import { storeMediaAssetBlobBytesIfAbsent } from "../storage";
import { buildMediaBlobStorageKey } from "../storageKeys";
import {
  normalizeImageBytesForCard,
  type NormalizedImageBytes,
} from "./imageNormalization";
import type {
  MediaAsset,
  MediaAssetImageIngestionMetadataInput,
  NormalizedImageMediaAssetInput,
} from "../types";
import type { BackendObservationScope } from "../../observability/sentry";

export type ImageMediaAssetIngestionInput = Readonly<{
  userId: string;
  workspaceId: string;
  metadata: MediaAssetImageIngestionMetadataInput;
  imageBytes: Buffer;
  observationScope: BackendObservationScope;
}>;

export type ImageMediaAssetIngestionResult = Readonly<{
  mediaAsset: MediaAsset;
  applied: boolean;
}>;

export type ImageMediaAssetIngestionDependencies = Readonly<{
  normalizeImageBytesForCardFn: (inputBytes: Buffer) => Promise<NormalizedImageBytes>;
  loadReusableImageMediaBlobForWorkspaceFn: typeof loadReusableImageMediaBlobForWorkspace;
  storeMediaAssetBlobBytesIfAbsentFn: typeof storeMediaAssetBlobBytesIfAbsent;
  createImageNormalizedMediaAssetForWorkspaceFn: typeof createImageNormalizedMediaAssetForWorkspace;
}>;

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toNormalizedImageMediaAssetInput(
  metadata: MediaAssetImageIngestionMetadataInput,
  normalizedImage: NormalizedImageBytes,
): NormalizedImageMediaAssetInput {
  return {
    mediaAssetId: metadata.mediaAssetId,
    sourceUrl: metadata.sourceUrl,
    createdAt: metadata.createdAt,
    clientUpdatedAt: metadata.clientUpdatedAt,
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    lastOperationId: metadata.lastOperationId,
    sizeBytes: normalizedImage.sizeBytes,
    sha256: sha256Hex(normalizedImage.bytes),
  };
}

export async function ingestImageMediaAssetWithDependencies(
  input: ImageMediaAssetIngestionInput,
  dependencies: ImageMediaAssetIngestionDependencies,
): Promise<ImageMediaAssetIngestionResult> {
  const normalizedImage = await dependencies.normalizeImageBytesForCardFn(input.imageBytes);
  const normalizedInput = toNormalizedImageMediaAssetInput(input.metadata, normalizedImage);
  const reusableBlob = await dependencies.loadReusableImageMediaBlobForWorkspaceFn(
    input.userId,
    input.workspaceId,
    normalizedInput,
  );

  if (reusableBlob === null) {
    await dependencies.storeMediaAssetBlobBytesIfAbsentFn({
      workspaceId: input.workspaceId,
      mediaAssetId: normalizedInput.mediaAssetId,
      storageKey: buildMediaBlobStorageKey(normalizedInput.sha256),
      mimeType: normalizedImage.mimeType,
      sha256: normalizedInput.sha256,
      lastOperationId: normalizedInput.lastOperationId,
      bytes: normalizedImage.bytes,
      observationScope: input.observationScope,
    });
  }

  return dependencies.createImageNormalizedMediaAssetForWorkspaceFn(
    input.userId,
    input.workspaceId,
    normalizedInput,
  );
}

export async function ingestImageMediaAsset(
  input: ImageMediaAssetIngestionInput,
): Promise<ImageMediaAssetIngestionResult> {
  return ingestImageMediaAssetWithDependencies(input, {
    normalizeImageBytesForCardFn: normalizeImageBytesForCard,
    loadReusableImageMediaBlobForWorkspaceFn: loadReusableImageMediaBlobForWorkspace,
    storeMediaAssetBlobBytesIfAbsentFn: storeMediaAssetBlobBytesIfAbsent,
    createImageNormalizedMediaAssetForWorkspaceFn: createImageNormalizedMediaAssetForWorkspace,
  });
}
