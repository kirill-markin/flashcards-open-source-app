import type { MediaAsset } from "../../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  describeIndexedDbError,
  getFromStore,
  runReadwrite,
  type StoredMediaAsset,
} from "../core/database";

function makeWorkspaceKeyRange(workspaceId: string): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId], [workspaceId, []]);
}

export function putMediaAssetInTransaction(transaction: IDBTransaction, mediaAsset: MediaAsset): void {
  transaction.objectStore("mediaAssets").put(mediaAsset satisfies StoredMediaAsset);
}

export async function putMediaAsset(mediaAsset: MediaAsset): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaAssets"], (transaction) => {
      putMediaAssetInTransaction(transaction, mediaAsset);
      return null;
    });
  });
}

export async function loadMediaAssetRecord(
  workspaceId: string,
  mediaAssetId: string,
): Promise<MediaAsset | null> {
  const record = await closeDatabaseAfter((database) => getFromStore<StoredMediaAsset>(
    database,
    "mediaAssets",
    [workspaceId, mediaAssetId],
  ));
  return record ?? null;
}

export async function replaceMediaAssets(
  workspaceId: string,
  mediaAssets: ReadonlyArray<MediaAsset>,
): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["mediaAssets"], (transaction) => {
      const mediaAssetsStore = transaction.objectStore("mediaAssets");
      const deleteMediaAssetsRequest = mediaAssetsStore.delete(makeWorkspaceKeyRange(workspaceId));
      for (const mediaAsset of mediaAssets) {
        if (mediaAsset.workspaceId !== workspaceId) {
          throw new Error(`Media asset workspace mismatch: expected=${workspaceId}, actual=${mediaAsset.workspaceId}`);
        }

        mediaAssetsStore.put(mediaAsset satisfies StoredMediaAsset);
      }

      deleteMediaAssetsRequest.onerror = () => {
        throw describeIndexedDbError("IndexedDB media asset replacement failed", deleteMediaAssetsRequest.error);
      };
      return deleteMediaAssetsRequest;
    });
  });
}
