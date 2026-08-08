import { getMediaAssetsS3Client, getMediaAssetsStorageConfig } from "./config";
import type { StoreMediaAssetBlobBytesInput } from "./contracts";
import { storeMediaAssetBlobBytesIfAbsentWithDependencies } from "./promotion/promotion";

export function storeMediaAssetBlobBytesIfAbsent(
  input: StoreMediaAssetBlobBytesInput,
): Promise<void> {
  return storeMediaAssetBlobBytesIfAbsentWithDependencies(input, {
    s3Client: getMediaAssetsS3Client(),
    getMediaAssetsStorageConfigFn: getMediaAssetsStorageConfig,
  });
}
