import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseLifecycleTests: LocalDatabaseTestCase {
    func testFreshInitializationCreatesDefaultBootstrapState() throws {
        let database = try self.makeDatabase()

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: database))
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "review_events",
                indexName: "idx_review_events_reviewed_at_client"
            )
        )
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "cards", columnName: "due_at_millis"))
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "cards", columnName: "fsrs_last_reviewed_at_millis"))
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "review_events", columnName: "reviewed_time_zone"))
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "outbox", columnName: "review_schedule_impact"))
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "media_assets", columnName: "media_asset_id"))
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "media_assets", columnName: "deleted_at"))
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_due_millis_active"
            )
        )
        XCTAssertEqual(
            try self.loadIndexColumnOrder(database: database, indexName: "idx_cards_workspace_due_millis_active"),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "due_at_millis", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: false),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_new_due_active"
            )
        )
        XCTAssertEqual(
            try self.loadIndexColumnOrder(database: database, indexName: "idx_cards_workspace_new_due_active"),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: false),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_fsrs_last_reviewed_millis_due_active"
            )
        )
        XCTAssertEqual(
            try self.loadIndexColumnOrder(
                database: database,
                indexName: "idx_cards_workspace_fsrs_last_reviewed_millis_due_active"
            ),
            [
                SQLiteIndexColumnOrder(name: "workspace_id", isDescending: false),
                SQLiteIndexColumnOrder(name: "fsrs_last_reviewed_at_millis", isDescending: false),
                SQLiteIndexColumnOrder(name: "due_at_millis", isDescending: false),
                SQLiteIndexColumnOrder(name: "created_at", isDescending: false),
                SQLiteIndexColumnOrder(name: "card_id", isDescending: false)
            ]
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "media_assets",
                indexName: "idx_media_assets_workspace_updated_at"
            )
        )
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "app_local_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "workspaces"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "user_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "sync_state"))

        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let userSettings = try database.workspaceSettingsStore.loadUserSettings()

        XCTAssertEqual(.disconnected, cloudSettings.cloudState)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettings.activeWorkspaceId)
        XCTAssertEqual(workspace.workspaceId, userSettings.workspaceId)
        XCTAssertEqual(
            1,
            try database.core.scalarInt(
                sql: "SELECT COUNT(*) FROM sync_state WHERE workspace_id = ?",
                values: [.text(workspace.workspaceId)]
            )
        )
    }

    func testAppWideReviewEventUsesDayExistenceSemantics() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let card = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
            ),
            cardId: nil
        )
        let reviewTime = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T12:00:00.000Z"))
        let dayStart = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-19T00:00:00.000Z"))
        let nextDayStart = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-20T00:00:00.000Z"))
        let followingDayStart = try XCTUnwrap(parseIsoTimestamp(value: "2026-04-21T00:00:00.000Z"))

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: formatIsoTimestamp(date: reviewTime),
                reviewedTimeZone: "UTC"
            )
        )

        XCTAssertTrue(try database.hasAppWideReviewEvent(start: dayStart, end: nextDayStart))
        XCTAssertFalse(try database.hasAppWideReviewEvent(start: nextDayStart, end: followingDayStart))
    }

    func testResetForAccountDeletionRecreatesDisconnectedDefaultState() throws {
        let database = try self.makeDatabase()
        let originalWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        _ = try database.saveCard(
            workspaceId: originalWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
            ),
            cardId: nil
        )
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: originalWorkspace.workspaceId,
            activeWorkspaceId: originalWorkspace.workspaceId,
            linkedEmail: "user@example.com"
        )

        try database.resetForAccountDeletion()

        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let userSettings = try database.workspaceSettingsStore.loadUserSettings()

        XCTAssertEqual(LocalDatabaseSchema.currentVersion, try self.loadSchemaVersion(database: database))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "app_local_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "workspaces"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "user_settings"))
        XCTAssertEqual(1, try self.countRows(database: database, tableName: "sync_state"))
        XCTAssertEqual(0, try self.countRows(database: database, tableName: "cards"))
        XCTAssertEqual(.disconnected, cloudSettings.cloudState)
        XCTAssertNil(cloudSettings.linkedUserId)
        XCTAssertNil(cloudSettings.linkedWorkspaceId)
        XCTAssertEqual(Optional(workspace.workspaceId), cloudSettings.activeWorkspaceId)
        XCTAssertEqual(workspace.workspaceId, userSettings.workspaceId)
    }

    func testMediaAssetRegistryMetadataPersistsAndExportsHotBootstrapEntry() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let mediaAsset = self.makeMediaAsset(workspaceId: workspace.workspaceId, deletedAt: nil)

        let applyResult = try database.applySyncBootstrapEntry(
            workspaceId: workspace.workspaceId,
            entry: SyncBootstrapEntry(
                entityType: .mediaAsset,
                entityId: mediaAsset.mediaAssetId,
                action: .upsert,
                payload: .mediaAsset(mediaAsset)
            )
        )

        XCTAssertTrue(applyResult.didApply)
        XCTAssertFalse(applyResult.reviewScheduleImpact)

        let storedMediaAsset = try XCTUnwrap(
            try database.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAsset.mediaAssetId
            )
        )
        XCTAssertEqual(storedMediaAsset, mediaAsset)

        let bootstrapEntries = try database.loadHotBootstrapEntries(workspaceId: workspace.workspaceId)
        let mediaEntry = try XCTUnwrap(bootstrapEntries.first { entry in
            entry.entityType == .mediaAsset && entry.entityId == mediaAsset.mediaAssetId
        })
        guard case .mediaAsset(let exportedMediaAsset) = mediaEntry.payload else {
            XCTFail("Expected media asset bootstrap payload")
            return
        }
        XCTAssertEqual(exportedMediaAsset, mediaAsset)

        let tombstone = self.makeMediaAsset(
            workspaceId: workspace.workspaceId,
            deletedAt: "2026-04-25T10:00:00.000Z"
        )
        _ = try database.applySyncBootstrapEntry(
            workspaceId: workspace.workspaceId,
            entry: SyncBootstrapEntry(
                entityType: .mediaAsset,
                entityId: tombstone.mediaAssetId,
                action: .upsert,
                payload: .mediaAsset(tombstone)
            )
        )

        let storedTombstone = try XCTUnwrap(
            try database.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspace.workspaceId,
                mediaAssetId: tombstone.mediaAssetId
            )
        )
        XCTAssertEqual(storedTombstone.deletedAt, "2026-04-25T10:00:00.000Z")
    }

    private func makeMediaAsset(workspaceId: String, deletedAt: String?) -> MediaAsset {
        MediaAsset(
            mediaAssetId: "00000000-0000-4000-8000-000000000001",
            workspaceId: workspaceId,
            mimeType: "image/png",
            sizeBytes: 1234,
            sha256: "sha",
            storageKey: "workspaces/\(workspaceId)/media/asset.png",
            sourceUrl: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: deletedAt == nil ? "2026-04-24T10:00:01.000Z" : "2026-04-25T10:00:00.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: deletedAt == nil ? "operation-media-1" : "operation-media-2",
            updatedAt: deletedAt == nil ? "2026-04-24T10:00:02.000Z" : "2026-04-25T10:00:01.000Z",
            deletedAt: deletedAt
        )
    }
}
