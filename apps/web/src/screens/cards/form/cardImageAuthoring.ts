import {
  buildClientWorkspaceReplicaId,
  calculateSha256Hex,
} from "../../../media/mediaCrypto";
import { buildManagedImageMarkdown } from "../../../media/managedMediaMarkdown";
import { prepareCardImageFile } from "../../../media/imagePreparation";
import {
  persistLocalMediaUpload,
  type MediaBlobCacheRecord,
} from "../../../localDb/mediaTransfers";
import type { MediaAsset } from "../../../types";

export type CardImageMediaAuthoringInput = Readonly<{
  workspaceId: string;
  installationId: string;
  file: File;
  altText: string;
}>;

export type CardMediaAuthoringResult = Readonly<{
  mediaAsset: MediaAsset;
  blob: Blob;
  markdown: string;
}>;

function requireNonEmptyInput(value: string, fieldName: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new Error(`Card image authoring requires ${fieldName}`);
  }

  return trimmedValue;
}

function createLocalMediaId(fieldName: string): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID !== "function") {
    throw new Error(`Card image authoring cannot create ${fieldName}: crypto.randomUUID is unavailable`);
  }

  return cryptoApi.randomUUID().toLowerCase();
}

function buildLocalMediaAsset(
  workspaceId: string,
  mediaAssetId: string,
  transferId: string,
  sha256: string,
  sizeBytes: number,
  lastModifiedByReplicaId: string,
  createdAt: string,
): MediaAsset {
  return {
    mediaAssetId,
    workspaceId,
    mimeType: "image/jpeg",
    sizeBytes,
    sha256,
    sourceUrl: null,
    createdAt,
    clientUpdatedAt: createdAt,
    lastModifiedByReplicaId,
    lastOperationId: transferId,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function buildMediaBlobCacheRecord(
  mediaAsset: MediaAsset,
  blob: Blob,
  createdAt: string,
): MediaBlobCacheRecord {
  return {
    sha256: mediaAsset.sha256,
    mimeType: mediaAsset.mimeType,
    sizeBytes: mediaAsset.sizeBytes,
    blob,
    createdAt,
    lastAccessedAt: createdAt,
    sourceMediaAssetId: mediaAsset.mediaAssetId,
  };
}

export async function prepareCardImageMediaAuthoring(
  input: CardImageMediaAuthoringInput,
): Promise<CardMediaAuthoringResult> {
  const workspaceId = requireNonEmptyInput(input.workspaceId, "workspaceId");
  const installationId = requireNonEmptyInput(input.installationId, "installationId");
  const preparedImage = await prepareCardImageFile(input.file);
  const bytes = await preparedImage.blob.arrayBuffer();
  const sha256 = await calculateSha256Hex(bytes);
  const createdAt = new Date().toISOString();
  const mediaAssetId = createLocalMediaId("mediaAssetId");
  const transferId = createLocalMediaId("transferId");
  const lastModifiedByReplicaId = await buildClientWorkspaceReplicaId(workspaceId, installationId);
  const mediaAsset = buildLocalMediaAsset(
    workspaceId,
    mediaAssetId,
    transferId,
    sha256,
    bytes.byteLength,
    lastModifiedByReplicaId,
    createdAt,
  );
  const cacheRecord = buildMediaBlobCacheRecord(mediaAsset, preparedImage.blob, createdAt);

  await persistLocalMediaUpload({
    mediaAsset,
    cacheRecord,
    upload: {
      transferId,
      workspaceId,
      mediaAssetId,
      sha256,
      mimeType: mediaAsset.mimeType,
      sizeBytes: mediaAsset.sizeBytes,
      sourceBlobCacheKey: sha256,
      createdAt,
      nextAttemptAt: createdAt,
    },
  });

  return {
    mediaAsset,
    blob: preparedImage.blob,
    markdown: buildManagedImageMarkdown({
      mediaAssetId,
      altText: input.altText,
    }),
  };
}
