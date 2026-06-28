import Foundation

let mediaAssetStoreSelectColumnsSQL: String = """
    media_asset_id,
    workspace_id,
    mime_type,
    size_bytes,
    sha256,
    storage_key,
    source_url,
    created_at,
    client_updated_at,
    last_modified_by_replica_id,
    last_operation_id,
    updated_at,
    deleted_at
"""

struct MediaAssetStore {
    let core: DatabaseCore

    func loadMediaAssetsIncludingDeleted(workspaceId: String) throws -> [MediaAsset] {
        try self.core.query(
            sql: """
            SELECT
            \(mediaAssetStoreSelectColumnsSQL)
            FROM media_assets
            WHERE workspace_id = ?
            ORDER BY updated_at DESC, media_asset_id ASC
            """,
            values: [.text(workspaceId)]
        ) { statement in
            self.mapMediaAsset(statement: statement)
        }
    }

    func loadOptionalMediaAssetIncludingDeleted(
        workspaceId: String,
        mediaAssetId: String
    ) throws -> MediaAsset? {
        let mediaAssets = try self.core.query(
            sql: """
            SELECT
            \(mediaAssetStoreSelectColumnsSQL)
            FROM media_assets
            WHERE workspace_id = ? AND media_asset_id = ?
            LIMIT 1
            """,
            values: [
                .text(workspaceId),
                .text(mediaAssetId)
            ]
        ) { statement in
            self.mapMediaAsset(statement: statement)
        }

        return mediaAssets.first
    }

    func mapMediaAsset(statement: OpaquePointer) -> MediaAsset {
        MediaAsset(
            mediaAssetId: DatabaseCore.columnText(statement: statement, index: 0),
            workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
            mimeType: DatabaseCore.columnText(statement: statement, index: 2),
            sizeBytes: DatabaseCore.columnInt64(statement: statement, index: 3),
            sha256: DatabaseCore.columnText(statement: statement, index: 4),
            storageKey: DatabaseCore.columnText(statement: statement, index: 5),
            sourceUrl: DatabaseCore.columnOptionalText(statement: statement, index: 6),
            createdAt: DatabaseCore.columnText(statement: statement, index: 7),
            clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 8),
            lastModifiedByReplicaId: DatabaseCore.columnText(statement: statement, index: 9),
            lastOperationId: DatabaseCore.columnText(statement: statement, index: 10),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 11),
            deletedAt: DatabaseCore.columnOptionalText(statement: statement, index: 12)
        )
    }
}
