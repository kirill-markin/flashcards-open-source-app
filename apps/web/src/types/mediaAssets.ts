export type MediaAsset = Readonly<{
  mediaAssetId: string;
  workspaceId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type MediaAssetSnapshotPayload = Readonly<{
  mediaAssetId: string;
  workspaceId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  createdAt: string;
  deletedAt: string | null;
}>;

export type PresignedMediaAssetDownload = Readonly<{
  method: "GET";
  url: string;
  expiresAt: string;
}>;

export type MediaAssetDownloadUrlResult = Readonly<{
  mediaAsset: MediaAsset;
  download: PresignedMediaAssetDownload;
}>;
