import { getMediaAssetsS3Client, getMediaAssetsStorageConfig } from "./config";
import type {
  StoreCatalogImageBlobBytesInput,
  StoreMediaAssetBlobBytesInput,
} from "./contracts";
import {
  storeCatalogImageBlobBytesIfAbsentWithDependencies,
  storeMediaAssetBlobBytesIfAbsentWithDependencies,
} from "./promotion/promotion";

export function storeMediaAssetBlobBytesIfAbsent(
  input: StoreMediaAssetBlobBytesInput,
): Promise<void> {
  return storeMediaAssetBlobBytesIfAbsentWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}

export function storeCatalogImageBlobBytesIfAbsent(
  input: StoreCatalogImageBlobBytesInput,
): Promise<void> {
  return storeCatalogImageBlobBytesIfAbsentWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}
