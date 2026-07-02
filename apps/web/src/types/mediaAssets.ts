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

export type MediaAssetUploadSession = Readonly<{
  sessionId: string;
  expiresAt: string;
  partSizeBytes: number;
  partCount: number;
}>;

export type MediaAssetUploadSessionCreateResult =
  | Readonly<{
    workspaceId: string;
    mediaAssetId: string;
    status: "already_available";
    mediaAsset: MediaAsset;
    uploadSession: null;
  }>
  | Readonly<{
    workspaceId: string;
    mediaAssetId: string;
    status: "upload_required";
    mediaAsset: null;
    uploadSession: MediaAssetUploadSession;
  }>;

export type MediaAssetUploadSessionPartRequest = Readonly<{
  partNumber: number;
  sha256: string;
}>;

export type MediaAssetUploadSessionPartUrlsInput = Readonly<{
  parts: ReadonlyArray<MediaAssetUploadSessionPartRequest>;
}>;

export type MediaAssetUploadPartUrl = Readonly<{
  partNumber: number;
  method: "PUT";
  url: string;
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
}>;

export type MediaAssetUploadSessionPartUrlsResult = Readonly<{
  sessionId: string;
  partUrls: ReadonlyArray<MediaAssetUploadPartUrl>;
}>;

export type CompleteMediaAssetUploadPartInput = Readonly<{
  partNumber: number;
  eTag: string;
  sha256: string;
}>;

export type CompleteMediaAssetUploadSessionInput = Readonly<{
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>;
}>;

export type MediaAssetUploadSessionCompleteResult = Readonly<{
  mediaAsset: MediaAsset;
  applied: boolean;
}>;

export type MediaAssetUploadSessionAbortResult = Readonly<{
  sessionId: string;
  abortedAt: string;
}>;
