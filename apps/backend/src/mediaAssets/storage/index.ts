import type {
  CreatedMultipartMediaAssetUpload,
  PresignedMediaAssetDownload,
  PresignedMediaAssetUpload,
  PresignedMediaAssetUploadPart,
} from "../types";
import {
  getMediaBlobCleanupS3Client,
  getMediaAssetsS3Client,
  getMediaAssetsStorageConfig,
} from "./config";
import type {
  AbortMultipartMediaAssetUploadInput,
  AbortMultipartMediaAssetUploadUntilDeadlineInput,
  AssertMediaAssetObjectInput,
  CompleteMultipartMediaAssetUploadInput,
  CreateMultipartMediaAssetUploadInput,
  DeletePermanentMediaBlobInput,
  LoadedMediaAssetObjectBytes,
  LoadMediaAssetObjectBytesInput,
  PresignMediaAssetDownloadInput,
  PresignMediaAssetUploadInput,
  PresignMultipartMediaAssetUploadPartsInput,
  PromoteMediaAssetUploadInput,
  ReconcileMultipartMediaAssetUploadInput,
  StoreMediaAssetBlobBytesInput,
} from "./contracts";
import { deletePermanentMediaBlobWithDependencies } from "./blobCleanup";
import {
  abortMultipartMediaAssetUploadWithDependencies,
  abortMultipartMediaAssetUploadUntilDeadlineWithDependencies,
  completeMultipartMediaAssetUploadWithDependencies,
  createMultipartMediaAssetUploadWithDependencies,
} from "./multipart";
import { reconcileMultipartMediaAssetUploadWithDependencies } from "./multipartReconciliation";
import {
  assertMediaAssetObjectMatchesWithDependencies,
  loadMediaAssetObjectBytesWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
} from "./objects";
import {
  createPresignedMediaAssetDownloadWithDependencies,
  createPresignedMediaAssetUploadPartsWithDependencies,
  createPresignedMediaAssetUploadWithDependencies,
} from "./presigned";
import {
  promoteMediaAssetUploadToBlobWithDependencies,
  storeMediaAssetBlobBytesIfAbsentWithDependencies,
} from "./promotion";
export {
  GeneratedMediaPromotionStorageTerminalError,
  GeneratedMediaPromotionStorageTransientError,
  loadGeneratedMediaStagingObject,
  loadGeneratedMediaStagingObjectWithDependencies,
  promoteGeneratedMediaObject,
  promoteGeneratedMediaObjectWithDependencies,
  storeGeneratedMediaStagingObject,
  storeGeneratedMediaStagingObjectWithDependencies,
} from "./generatedPromotion";
export type {
  GeneratedMediaObjectPromotionInput,
  GeneratedMediaStagingObject,
  GeneratedMediaStagingObjectInput,
  StoreGeneratedMediaStagingObjectInput,
} from "./generatedPromotion";

export { getMediaAssetsStorageConfig } from "./config";
export type { MediaAssetsStorageConfig } from "./config";
export type {
  AbortMultipartMediaAssetUploadInput,
  AbortMultipartMediaAssetUploadUntilDeadlineInput,
  AssertMediaAssetObjectInput,
  CompleteMultipartMediaAssetUploadInput,
  CreateMultipartMediaAssetUploadInput,
  DeletePermanentMediaBlobInput,
  LoadedMediaAssetObjectBytes,
  LoadMediaAssetObjectBytesInput,
  MediaAssetStorageDependencies,
  PresignMediaAssetDownloadInput,
  PresignMediaAssetUploadInput,
  PresignMultipartMediaAssetUploadPartsInput,
  PromoteMediaAssetUploadInput,
  ReconcileMultipartMediaAssetUploadInput,
  StoreMediaAssetBlobBytesInput,
} from "./contracts";
export {
  deletePermanentMediaBlobWithDependencies,
  MediaBlobCleanupStorageAmbiguousDeleteError,
  MediaBlobCleanupStorageConditionalConflictError,
  MediaBlobCleanupStorageTerminalError,
  MediaBlobCleanupStorageTransientError,
  type PermanentMediaBlobDeleteOutcome,
} from "./blobCleanup";
export {
  abortMultipartMediaAssetUploadWithDependencies,
  abortMultipartMediaAssetUploadUntilDeadlineWithDependencies,
  completeMultipartMediaAssetUploadWithDependencies,
  createMultipartMediaAssetUploadWithDependencies,
} from "./multipart";
export {
  createMultipartCompletedPartsFingerprint,
  reconcileMultipartMediaAssetUploadWithDependencies,
} from "./multipartReconciliation";
export {
  MultipartCompletionReconciliationStorageTerminalError,
  MultipartCompletionReconciliationStorageTransientError,
} from "./errors";
export {
  assertMediaAssetObjectMatchesWithDependencies,
  loadMediaAssetObjectBytesWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
} from "./objects";
export {
  createPresignedMediaAssetDownloadWithDependencies,
  createPresignedMediaAssetUploadPartsWithDependencies,
  createPresignedMediaAssetUploadWithDependencies,
} from "./presigned";
export {
  promoteMediaAssetUploadToBlobWithDependencies,
  storeMediaAssetBlobBytesIfAbsentWithDependencies,
} from "./promotion";

export async function createMultipartMediaAssetUpload(
  input: CreateMultipartMediaAssetUploadInput,
): Promise<CreatedMultipartMediaAssetUpload> {
  return createMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function deletePermanentMediaBlob(
  input: DeletePermanentMediaBlobInput,
): Promise<import("./blobCleanup").PermanentMediaBlobDeleteOutcome> {
  return deletePermanentMediaBlobWithDependencies(input, {
    s3Client: getMediaBlobCleanupS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function createPresignedMediaAssetUpload(
  input: PresignMediaAssetUploadInput,
): Promise<PresignedMediaAssetUpload> {
  return createPresignedMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function createPresignedMediaAssetUploadParts(
  input: PresignMultipartMediaAssetUploadPartsInput,
): Promise<ReadonlyArray<PresignedMediaAssetUploadPart>> {
  return createPresignedMediaAssetUploadPartsWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function createPresignedMediaAssetDownload(
  input: PresignMediaAssetDownloadInput,
): Promise<PresignedMediaAssetDownload> {
  return createPresignedMediaAssetDownloadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function storeMediaAssetBlobBytesIfAbsent(
  input: StoreMediaAssetBlobBytesInput,
): Promise<void> {
  return storeMediaAssetBlobBytesIfAbsentWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function assertMediaAssetObjectMatches(
  input: AssertMediaAssetObjectInput,
): Promise<void> {
  return assertMediaAssetObjectMatchesWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function loadMediaAssetObjectBytes(
  input: LoadMediaAssetObjectBytesInput,
): Promise<LoadedMediaAssetObjectBytes> {
  return loadMediaAssetObjectBytesWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function promoteMediaAssetUploadToBlob(
  input: PromoteMediaAssetUploadInput,
): Promise<void> {
  return promoteMediaAssetUploadToBlobWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function completeMultipartMediaAssetUpload(
  input: CompleteMultipartMediaAssetUploadInput,
): Promise<void> {
  return completeMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function abortMultipartMediaAssetUpload(
  input: AbortMultipartMediaAssetUploadInput,
): Promise<void> {
  return abortMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function abortMultipartMediaAssetUploadUntilDeadline(
  input: AbortMultipartMediaAssetUploadUntilDeadlineInput,
): Promise<void> {
  return abortMultipartMediaAssetUploadUntilDeadlineWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export async function reconcileMultipartMediaAssetUpload(
  input: ReconcileMultipartMediaAssetUploadInput,
): Promise<void> {
  return reconcileMultipartMediaAssetUploadWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}
