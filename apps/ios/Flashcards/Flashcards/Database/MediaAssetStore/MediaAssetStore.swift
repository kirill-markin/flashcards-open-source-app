import Foundation

let mediaAssetStoreSelectColumnsSQL: String = """
    media_asset_id,
    workspace_id,
    mime_type,
    size_bytes,
    sha256,
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

    func upsertMediaAsset(workspaceId: String, mediaAsset: MediaAsset) throws {
        try self.core.execute(
            sql: """
            INSERT INTO media_assets (
                media_asset_id,
                workspace_id,
                mime_type,
                size_bytes,
                sha256,
                source_url,
                created_at,
                client_updated_at,
                last_modified_by_replica_id,
                last_operation_id,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, media_asset_id) DO UPDATE SET
                mime_type = excluded.mime_type,
                size_bytes = excluded.size_bytes,
                sha256 = excluded.sha256,
                source_url = excluded.source_url,
                created_at = excluded.created_at,
                client_updated_at = excluded.client_updated_at,
                last_modified_by_replica_id = excluded.last_modified_by_replica_id,
                last_operation_id = excluded.last_operation_id,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at
            """,
            values: [
                .text(mediaAsset.mediaAssetId),
                .text(workspaceId),
                .text(mediaAsset.mimeType),
                .integer(mediaAsset.sizeBytes),
                .text(mediaAsset.sha256),
                mediaAsset.sourceUrl.map(SQLiteValue.text) ?? .null,
                .text(mediaAsset.createdAt),
                .text(mediaAsset.clientUpdatedAt),
                .text(mediaAsset.lastModifiedByReplicaId),
                .text(mediaAsset.lastOperationId),
                .text(mediaAsset.updatedAt),
                mediaAsset.deletedAt.map(SQLiteValue.text) ?? .null
            ]
        )
    }

    func mapMediaAsset(statement: OpaquePointer) -> MediaAsset {
        MediaAsset(
            mediaAssetId: DatabaseCore.columnText(statement: statement, index: 0),
            workspaceId: DatabaseCore.columnText(statement: statement, index: 1),
            mimeType: DatabaseCore.columnText(statement: statement, index: 2),
            sizeBytes: DatabaseCore.columnInt64(statement: statement, index: 3),
            sha256: DatabaseCore.columnText(statement: statement, index: 4),
            sourceUrl: DatabaseCore.columnOptionalText(statement: statement, index: 5),
            createdAt: DatabaseCore.columnText(statement: statement, index: 6),
            clientUpdatedAt: DatabaseCore.columnText(statement: statement, index: 7),
            lastModifiedByReplicaId: DatabaseCore.columnText(statement: statement, index: 8),
            lastOperationId: DatabaseCore.columnText(statement: statement, index: 9),
            updatedAt: DatabaseCore.columnText(statement: statement, index: 10),
            deletedAt: DatabaseCore.columnOptionalText(statement: statement, index: 11)
        )
    }
}
