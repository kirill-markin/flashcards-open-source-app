export type TimestampValue = Date | string;

export type MediaAssetRow = Readonly<{
  media_asset_id: string;
  workspace_id: string;
  media_blob_id: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_key: string;
  blob_created_at: TimestampValue;
  blob_updated_at: TimestampValue;
  source_url: string | null;
  created_at: TimestampValue;
  client_updated_at: TimestampValue;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  updated_at: TimestampValue;
  deleted_at: TimestampValue | null;
}>;

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

export type MediaBlob = Readonly<{
  mediaBlobId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
  updatedAt: string;
}>;

export type MediaBlobRow = Readonly<{
  media_blob_id: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_key: string;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}>;

export type MediaAssetWithBlob = Readonly<{
  mediaAsset: MediaAsset;
  mediaBlob: MediaBlob;
}>;

export type MediaAssetUploadIntentInput = Readonly<{
  mediaAssetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
}>;

export type CompleteMediaAssetUploadInput = Readonly<{
  mediaAssetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

export type MediaAssetMutationMetadata = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

export type MediaAssetSnapshotInput = Readonly<{
  mediaAssetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  createdAt: string;
  deletedAt: string | null;
}>;

export type MediaAssetMutationResult = Readonly<{
  mediaAsset: MediaAsset;
  applied: boolean;
}>;

export type MediaAssetSyncMutationResult = Readonly<{
  mediaAsset: MediaAsset;
  applied: boolean;
  changeId: number | null;
}>;

export type PresignedMediaAssetUpload = Readonly<{
  method: "PUT";
  url: string;
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
}>;

export type PresignedMediaAssetDownload = Readonly<{
  method: "GET";
  url: string;
  expiresAt: string;
}>;

export type MediaAssetObjectMetadata = Readonly<{
  sizeBytes: number | null;
  mimeType: string | null;
  checksumSha256: string | null;
  uploadProof: Readonly<{
    workspaceId: string | null;
    mediaAssetId: string | null;
    lastOperationIdSha256: string | null;
    sha256: string | null;
  }>;
}>;
