import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
} from "../../database";
import {
  MEDIA_ASSET_COLUMNS,
  MEDIA_ASSET_JOIN_CLAUSE,
  mapMediaAssetRow,
} from "../../mediaAssets";
import type {
  MediaAsset,
  MediaAssetRow,
} from "../../mediaAssets/types";

/**
 * Loads the guest workspace media asset registry rows together with their
 * deduplicated blob metadata. The merge re-registers these logical rows in the
 * target workspace; the shared `content.media_blobs` row and its object storage
 * bytes are never copied or re-keyed.
 */
export async function loadGuestMediaAssetsInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
): Promise<ReadonlyArray<MediaAsset>> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, {
    userId: guestUserId,
    workspaceId: guestWorkspaceId,
  });

  const result = await executor.query<MediaAssetRow>(
    [
      "SELECT",
      MEDIA_ASSET_COLUMNS,
      "FROM",
      MEDIA_ASSET_JOIN_CLAUSE,
      "WHERE media_assets.workspace_id = $1",
      "ORDER BY media_assets.created_at ASC, media_assets.media_asset_id ASC",
    ].join(" "),
    [guestWorkspaceId],
  );

  return result.rows.map(mapMediaAssetRow);
}
