import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
} from "../core/database";
import type { MediaBlobCacheRecord } from "./types";

export async function loadMediaBlobCacheRecord(sha256: string): Promise<MediaBlobCacheRecord | null> {
  const record = await closeDatabaseAfter((database) => getFromStore<MediaBlobCacheRecord>(
    database,
    "mediaBlobCache",
    sha256,
  ));
  return record ?? null;
}

export async function writeMediaBlobCacheRecord(record: MediaBlobCacheRecord): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaBlobCache"], (transaction) => (
      transaction.objectStore("mediaBlobCache").put(record)
    ));
  });
}

export async function deleteMediaBlobCacheRecord(sha256: string): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaBlobCache"], (transaction) => (
      transaction.objectStore("mediaBlobCache").delete(sha256)
    ));
  });
}
