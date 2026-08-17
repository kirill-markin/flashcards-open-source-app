import {
  closeDatabaseAfterWrite,
  runReadwrite,
  type StoredMediaAsset,
} from "../core/database";
import { createQueuedMediaTransferRecord } from "./transferQueue";
import type {
  MediaTransferQueueRecord,
  PersistLocalMediaUploadInput,
} from "./types";

export async function persistLocalMediaUpload(
  input: PersistLocalMediaUploadInput,
): Promise<MediaTransferQueueRecord> {
  const transferRecord = createQueuedMediaTransferRecord(input.upload, "upload", input.upload.sourceBlobCacheKey);
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaBlobCache", "mediaAssets", "mediaTransferQueue"], (transaction) => {
      transaction.objectStore("mediaBlobCache").put(input.cacheRecord);
      transaction.objectStore("mediaAssets").put(input.mediaAsset satisfies StoredMediaAsset);
      return transaction.objectStore("mediaTransferQueue").put(transferRecord);
    });
  });
  return transferRecord;
}
