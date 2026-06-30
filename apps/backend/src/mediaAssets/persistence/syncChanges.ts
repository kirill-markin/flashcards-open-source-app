import type { DatabaseExecutor } from "../../database";
import {
  insertSyncChange,
  type HotChangeWriteLock,
} from "../../sync/replication/changes";
import type { MediaAsset } from "../types";

export async function recordMediaAssetSyncChange(
  executor: DatabaseExecutor,
  workspaceId: string,
  hotChangeWriteLock: HotChangeWriteLock,
  mediaAsset: MediaAsset,
): Promise<number> {
  return insertSyncChange(
    executor,
    workspaceId,
    hotChangeWriteLock,
    "media_asset",
    mediaAsset.mediaAssetId,
    "upsert",
    mediaAsset.lastModifiedByReplicaId,
    mediaAsset.lastOperationId,
    mediaAsset.clientUpdatedAt,
  );
}
