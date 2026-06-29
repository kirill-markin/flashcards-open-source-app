export type TimestampValue = Date | string;

export const imageJpegCardMediaBlobMimeType = "image/jpeg";
export const passthroughMediaBlobNormalizationVersion = "passthrough-v1";
export const imageJpegCardMediaBlobNormalizationVersion = "image-jpeg-card-v1";

export const mediaBlobNormalizationVersions = [
  passthroughMediaBlobNormalizationVersion,
  imageJpegCardMediaBlobNormalizationVersion,
] as const;

export type MediaBlobNormalizationVersion = typeof mediaBlobNormalizationVersions[number];

export type MediaAssetRow = Readonly<{
  media_asset_id: string;
  workspace_id: string;
  media_blob_id: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_key: string;
  blob_normalization_version: string;
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
  normalizationVersion: MediaBlobNormalizationVersion;
  createdAt: string;
  updatedAt: string;
}>;

export type MediaBlobRow = Readonly<{
  media_blob_id: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_key: string;
  normalization_version: string;
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

export type MediaAssetImageIngestionMetadataInput = Readonly<{
  mediaAssetId: string;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

export type NormalizedImageMediaAssetInput = MediaAssetImageIngestionMetadataInput & Readonly<{
  sizeBytes: number;
  sha256: string;
}>;

export type MediaAssetUploadSessionCreateInput = Readonly<{
  mediaAssetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  partSizeBytes: number;
  partCount: number;
  sourceUrl: string | null;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
}>;

export type MediaAssetUploadSessionPartRequest = Readonly<{
  partNumber: number;
  sha256: string;
}>;

export type MediaAssetUploadSessionPartUrlsInput = Readonly<{
  parts: ReadonlyArray<MediaAssetUploadSessionPartRequest>;
}>;

export type CompleteMediaAssetUploadPartInput = Readonly<{
  partNumber: number;
  eTag: string;
  sha256: string;
}>;

export type CompleteMediaAssetUploadSessionInput = Readonly<{
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>;
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

export type MediaAssetUploadSessionRow = Readonly<{
  media_upload_session_id: string;
  workspace_id: string;
  media_asset_id: string;
  media_blob_sha256: string;
  staging_storage_key: string;
  blob_storage_key: string;
  s3_upload_id: string;
  mime_type: string;
  size_bytes: string | number;
  part_size_bytes: string | number;
  part_count: string | number;
  state: MediaAssetUploadSessionState;
  source_url: string | null;
  asset_created_at: TimestampValue;
  client_updated_at: TimestampValue;
  last_modified_by_replica_id: string;
  last_operation_id: string;
  expires_at: TimestampValue;
  created_at: TimestampValue;
  completed_at: TimestampValue | null;
  aborted_at: TimestampValue | null;
}>;

export type MediaAssetUploadSession = Readonly<{
  sessionId: string;
  workspaceId: string;
  mediaAssetId: string;
  mediaBlobSha256: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  s3UploadId: string;
  mimeType: string;
  sizeBytes: number;
  partSizeBytes: number;
  partCount: number;
  state: MediaAssetUploadSessionState;
  sourceUrl: string | null;
  assetCreatedAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  lastOperationId: string;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  abortedAt: string | null;
}>;

export type MediaAssetUploadSessionCreateResult =
  | Readonly<{
    status: "already_available";
    mediaAsset: MediaAsset;
    applied: boolean;
  }>
  | Readonly<{
    status: "upload_required";
    uploadSession: MediaAssetUploadSession;
  }>;

export type MediaAssetUploadSessionCompletionStartResult =
  | Readonly<{
    status: "complete_required";
    uploadSession: MediaAssetUploadSession;
  }>
  | Readonly<{
    status: "already_completed";
    mediaAsset: MediaAsset;
    applied: false;
  }>;

export type MediaAssetUploadSessionAbortStartResult =
  | Readonly<{
    status: "abort_required";
    uploadSession: MediaAssetUploadSession;
  }>
  | Readonly<{
    status: "already_aborted";
    uploadSession: MediaAssetUploadSession;
  }>;

export type MediaAssetUploadSessionState =
  | "active"
  | "completing"
  | "completed"
  | "aborting"
  | "aborted";

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
  rangeRequests: true;
}>;

export type CreatedMultipartMediaAssetUpload = Readonly<{
  storageKey: string;
  s3UploadId: string;
  expiresAt: string;
}>;

export type PresignedMediaAssetUploadPart = Readonly<{
  partNumber: number;
  method: "PUT";
  url: string;
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
}>;

export type MediaAssetObjectMetadata = Readonly<{
  sizeBytes: number | null;
  mimeType: string | null;
  checksumSha256: string | null;
  checksumType: "COMPOSITE" | "FULL_OBJECT" | null;
  uploadProof: Readonly<{
    workspaceId: string | null;
    mediaAssetId: string | null;
    lastOperationIdSha256: string | null;
    sha256: string | null;
  }>;
}>;
