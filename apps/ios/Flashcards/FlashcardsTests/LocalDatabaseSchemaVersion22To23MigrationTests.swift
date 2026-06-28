import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseSchemaVersion22To23MigrationTests: LocalDatabaseTestCase {
    func testSchemaVersion22MigrationDropsMediaAssetStorageKey() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let mediaAsset = MediaAsset(
            mediaAssetId: "00000000-0000-4000-8000-000000000001",
            workspaceId: workspace.workspaceId,
            mimeType: "image/png",
            sizeBytes: 1234,
            sha256: "sha",
            sourceUrl: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: "2026-04-24T10:00:01.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: "operation-media-1",
            updatedAt: "2026-04-24T10:00:02.000Z",
            deletedAt: nil
        )

        _ = try database.applySyncBootstrapEntry(
            workspaceId: workspace.workspaceId,
            entry: SyncBootstrapEntry(
                entityType: .mediaAsset,
                entityId: mediaAsset.mediaAssetId,
                action: .upsert,
                payload: .mediaAsset(mediaAsset)
            )
        )
        try database.core.execute(
            sql: """
            ALTER TABLE media_assets
            ADD COLUMN storage_key TEXT NOT NULL DEFAULT 'legacy-storage-key' CHECK (length(trim(storage_key)) > 0)
            """,
            values: []
        )
        try database.core.executeScript(
            sql: "PRAGMA user_version = 22;",
            errorContext: "Failed to prepare schema v22 fixture"
        )
        try database.close()
        self.database = nil

        let migratedDatabase = try LocalDatabase(databaseURL: try XCTUnwrap(self.databaseURL))
        self.database = migratedDatabase

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: migratedDatabase))
        XCTAssertFalse(try self.hasColumn(database: migratedDatabase, tableName: "media_assets", columnName: "storage_key"))
        let migratedMediaAsset = try XCTUnwrap(
            try migratedDatabase.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAsset.mediaAssetId
            )
        )
        XCTAssertEqual(migratedMediaAsset, mediaAsset)
    }
}
