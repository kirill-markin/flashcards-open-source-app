import type {
  CreatedMultipartMediaAssetUpload,
  PresignedMediaAssetDownload,
  PresignedMediaAssetUpload,
  PresignedMediaAssetUploadPart,
} from "../types";
import {
  getMediaAssetsS3Client,
  getMediaAssetsStorageConfig,
} from "./config";
import type {
  AbortMultipartMediaAssetUploadInput,
  AssertMediaAssetObjectInput,
  CompleteMultipartMediaAssetUploadInput,
  CreateMultipartMediaAssetUploadInput,
  LoadedMediaAssetObjectBytes,
  LoadMediaAssetObjectBytesInput,
  PresignMediaAssetDownloadInput,
  PresignMediaAssetUploadInput,
  PresignMultipartMediaAssetUploadPartsInput,
  PromoteMediaAssetUploadInput,
  StoreMediaAssetBlobBytesInput,
} from "./contracts";
import {
  abortMultipartMediaAssetUploadWithDependencies,
  completeMultipartMediaAssetUploadWithDependencies,
  createMultipartMediaAssetUploadWithDependencies,
} from "./multipart";
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

export { getMediaAssetsStorageConfig } from "./config";
export type { MediaAssetsStorageConfig } from "./config";
export type {
  AbortMultipartMediaAssetUploadInput,
  AssertMediaAssetObjectInput,
  CompleteMultipartMediaAssetUploadInput,
  CreateMultipartMediaAssetUploadInput,
  LoadedMediaAssetObjectBytes,
  LoadMediaAssetObjectBytesInput,
  MediaAssetStorageDependencies,
  PresignMediaAssetDownloadInput,
  PresignMediaAssetUploadInput,
  PresignMultipartMediaAssetUploadPartsInput,
  PromoteMediaAssetUploadInput,
  StoreMediaAssetBlobBytesInput,
} from "./contracts";
export {
  abortMultipartMediaAssetUploadWithDependencies,
  completeMultipartMediaAssetUploadWithDependencies,
  createMultipartMediaAssetUploadWithDependencies,
} from "./multipart";
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
