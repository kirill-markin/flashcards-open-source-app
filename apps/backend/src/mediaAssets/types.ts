export type TimestampValue = Date | string;

export type MediaAssetRow = Readonly<{
  media_asset_id: string;
  workspace_id: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_key: string;
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
  storageKey: string;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type MediaAssetUploadIntentInput = Readonly<{
  mediaAssetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
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

export type MediaAssetMutationResult = Readonly<{
  mediaAsset: MediaAsset;
  applied: boolean;
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
}>;
