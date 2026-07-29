import type { S3Client } from "@aws-sdk/client-s3";
import type { BackendObservationScope } from "../../observability/sentry/events";
import type {
  DirectMediaBlobStorageCapability,
  DirectMediaBlobWriterAttemptExactInput,
} from "../blobLifecycle";
import type {
  CompleteMediaAssetUploadPartInput,
  MediaAssetUploadSessionPartRequest,
} from "../types";
import type {
  MultipartMediaBlobStorageCapability,
  MultipartMediaBlobWriterAttemptExactInput,
} from "../uploadSessions";
import type { getMediaAssetsStorageConfig } from "./config";

export type MediaAssetStorageContext = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  observationScope: BackendObservationScope;
}>;

export type PresignMediaAssetUploadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  sha256: string;
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

export type PresignMediaAssetDownloadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  observationScope: BackendObservationScope;
}>;

export type CreateMultipartMediaAssetUploadInput = Readonly<{
  signal: AbortSignal;
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  mimeType: string;
  sha256: string;
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

export type PresignMultipartMediaAssetUploadPartsInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  s3UploadId: string;
  parts: ReadonlyArray<MediaAssetUploadSessionPartRequest>;
  observationScope: BackendObservationScope;
}>;

export type StoreMediaAssetBlobBytesInput = Readonly<{
  writer: DirectMediaBlobWriterAttemptExactInput;
  storageCapability: DirectMediaBlobStorageCapability;
  signal: AbortSignal;
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  sha256: string;
  lastOperationId: string;
  bytes: Buffer;
  observationScope: BackendObservationScope;
}>;

export type AssertMediaAssetObjectInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

export type LoadMediaAssetObjectBytesInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  maxByteSize: number;
  observationScope: BackendObservationScope;
}>;

export type LoadedMediaAssetObjectBytes = Readonly<{
  bytes: Buffer;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
}>;

export type CompleteMultipartMediaAssetUploadInput = Readonly<{
  writer: MultipartMediaBlobWriterAttemptExactInput;
  getStorageCapability: () => Promise<MultipartMediaBlobStorageCapability>;
  assertStorageMutationAuthorized: () => void;
  signal: AbortSignal;
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  s3UploadId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
  parts: ReadonlyArray<CompleteMediaAssetUploadPartInput>;
  observationScope: BackendObservationScope;
}>;

export type ReconcileMultipartMediaAssetUploadInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  blobStorageKey: string;
  s3UploadId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
  partCount: number;
  completedPartsFingerprint: string;
  renewLease: () => Promise<void>;
  signal: AbortSignal;
  observationScope: BackendObservationScope;
}>;

export type AbortMultipartMediaAssetUploadInput = Readonly<{
  signal: AbortSignal;
  workspaceId: string;
  mediaAssetId: string;
  stagingStorageKey: string;
  s3UploadId: string;
  observationScope: BackendObservationScope;
}>;

export type AbortMultipartMediaAssetUploadUntilDeadlineInput =
  AbortMultipartMediaAssetUploadInput
  & Readonly<{ signal: AbortSignal }>;

export type PromoteMediaAssetUploadInput = Readonly<{
  writer: MultipartMediaBlobWriterAttemptExactInput;
  getStorageCapability: () => Promise<MultipartMediaBlobStorageCapability>;
  assertStorageMutationAuthorized: () => void;
  signal: AbortSignal;
  workspaceId: string;
  mediaAssetId: string;
  uploadStorageKey: string;
  blobStorageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  lastOperationId: string;
  observationScope: BackendObservationScope;
}>;

export type MediaAssetStorageOperation =
  | "create_presigned_upload"
  | "create_presigned_download"
  | "create_multipart_upload"
  | "create_presigned_part_upload"
  | "complete_multipart_upload"
  | "abort_multipart_upload"
  | "list_multipart_upload_parts"
  | "head_object"
  | "get_object"
  | "copy_object"
  | "put_object";

export type MediaAssetObjectContentHash = Readonly<{
  sizeBytes: number;
  sha256: string;
}>;

export type MediaAssetStorageDependencies = Readonly<{
  s3Client: S3Client;
  getMediaAssetsStorageConfigFn: typeof getMediaAssetsStorageConfig;
}>;
