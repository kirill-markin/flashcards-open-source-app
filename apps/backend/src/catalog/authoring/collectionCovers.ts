import type { DatabaseExecutor } from "../../database";
import { rethrowCatalogPersistenceError } from "../errors";
import {
  catalogCollectionCoverColumns,
  lockCatalogCollectionCoverInExecutor,
  mapCatalogCollectionCoverRow,
} from "../rows";
import type {
  CatalogCollectionCover,
  CatalogCollectionCoverRow,
} from "../types";
import { scheduleDisplacedMediaBlobCleanupInExecutor } from "./draftMedia";

export type CatalogCollectionCoverMutationResult = Readonly<{
  collectionCover: CatalogCollectionCover;
  applied: boolean;
}>;

export async function replaceCatalogCollectionCoverInExecutor(
  executor: DatabaseExecutor,
  collectionId: string,
  mediaBlobId: string,
): Promise<CatalogCollectionCoverMutationResult> {
  try {
    const existing = await lockCatalogCollectionCoverInExecutor(
      executor,
      collectionId,
    );
    if (existing.cover_media_blob_id === mediaBlobId) {
      return {
        collectionCover: mapCatalogCollectionCoverRow(existing),
        applied: false,
      };
    }

    await executor.query(
      "SELECT content.lock_media_blob_lifecycles_for_reference_swap($1, $2)",
      [existing.cover_media_blob_id, mediaBlobId],
    );

    const updateResult = await executor.query<CatalogCollectionCoverRow>(
      [
        "UPDATE catalog.collections",
        "SET cover_media_blob_id = $2",
        "WHERE collection_id = $1",
        "RETURNING",
        catalogCollectionCoverColumns,
      ].join(" "),
      [collectionId, mediaBlobId],
    );
    const updated = updateResult.rows[0];
    if (updated === undefined) {
      throw new Error(
        `Locked catalog collection disappeared during cover replacement. collectionId=${collectionId}`,
      );
    }
    if (existing.cover_media_blob_id !== null) {
      await scheduleDisplacedMediaBlobCleanupInExecutor(
        executor,
        existing.cover_media_blob_id,
      );
    }
    return {
      collectionCover: mapCatalogCollectionCoverRow(updated),
      applied: true,
    };
  } catch (error) {
    rethrowCatalogPersistenceError(error);
  }
}
