import CryptoKit
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
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
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
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
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

    func testMediaAssetRegistryMetadataPersistsWithoutHotBootstrapExport() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let mediaAsset = self.makeMediaAsset(workspaceId: workspace.workspaceId, deletedAt: nil)
        XCTAssertFalse(try self.hasColumn(database: database, tableName: "media_assets", columnName: "storage_key"))

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
        XCTAssertFalse(bootstrapEntries.contains { entry in
            entry.entityType == .mediaAsset && entry.entityId == mediaAsset.mediaAssetId
        })

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

    func testReferencedCachedMediaAssetQueuesUploadBeforeHotBootstrap() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let mediaBytes = Data([0x01, 0x02, 0x03, 0x04])
        let mediaSha256 = self.hexSHA256(data: mediaBytes)
        let mediaAssetId = "00000000-0000-4000-8000-000000000011"
        let mediaAsset = MediaAsset(
            mediaAssetId: mediaAssetId,
            workspaceId: workspace.workspaceId,
            mimeType: "image/jpeg",
            sizeBytes: Int64(mediaBytes.count),
            sha256: mediaSha256,
            sourceUrl: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: "2026-04-24T10:00:01.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: "operation-media-1",
            updatedAt: "2026-04-24T10:00:02.000Z",
            deletedAt: nil
        )
        try database.mediaAssetStore.upsertMediaAsset(
            workspaceId: workspace.workspaceId,
            mediaAsset: mediaAsset
        )
        let cacheEntry = try database.mediaTransferStore.upsertBlobCacheEntry(
            entry: MediaBlobCacheUpsert(
                sha256: mediaSha256,
                mimeType: mediaAsset.mimeType,
                sizeBytes: mediaAsset.sizeBytes,
                createdAt: mediaAsset.createdAt,
                lastAccessedAt: mediaAsset.createdAt,
                sourceMediaAssetId: mediaAssetId
            )
        )
        try self.writeMediaCacheFile(database: database, cacheEntry: cacheEntry, data: mediaBytes)

        let markdown = try managedImageMarkdownReference(mediaAssetId: mediaAssetId, altText: "cached media")
        _ = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: markdown,
                backText: "Answer",
                tags: [],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )

        let failedTransfer = try database.mediaTransferStore.enqueueTransfer(
            request: MediaTransferEnqueueRequest(
                transferId: "00000000-0000-4000-8000-000000000012",
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAssetId,
                kind: .upload,
                sha256: mediaSha256,
                mimeType: mediaAsset.mimeType,
                sizeBytes: mediaAsset.sizeBytes,
                createdAt: mediaAsset.createdAt
            )
        )
        try database.core.execute(
            sql: """
            UPDATE media_transfer_queue
            SET
                status = 'failed',
                next_attempt_at = ?,
                last_error = ?,
                updated_at = ?
            WHERE transfer_id = ?
            """,
            values: [
                .text(mediaUploadPermanentFailureNextAttemptAt),
                .text("Permanent previous failure"),
                .text("2026-04-24T10:00:03.000Z"),
                .text(failedTransfer.transferId)
            ]
        )

        let transferEntries = try database.prepareReferencedMediaAssetUploadsForHotBootstrap(
            workspaceId: workspace.workspaceId
        )

        XCTAssertEqual(transferEntries.count, 1)
        XCTAssertEqual(transferEntries.first?.workspaceId, workspace.workspaceId)
        XCTAssertEqual(transferEntries.first?.mediaAssetId, mediaAssetId)
        XCTAssertEqual(transferEntries.first?.kind, .upload)
        XCTAssertEqual(transferEntries.first?.status, .pending)
        XCTAssertEqual(transferEntries.first?.sha256, mediaSha256)
        XCTAssertEqual(transferEntries.first?.localRelativePath, cacheEntry.localRelativePath)
        XCTAssertTrue(
            try database.mediaTransferStore.hasPendingUploadTransferMatchingAsset(
                workspaceId: workspace.workspaceId,
                mediaAssetId: mediaAssetId,
                sha256: mediaSha256,
                mimeType: mediaAsset.mimeType,
                sizeBytes: mediaAsset.sizeBytes
            )
        )

        let duplicateTransferEntries = try database.prepareReferencedMediaAssetUploadsForHotBootstrap(
            workspaceId: workspace.workspaceId
        )
        XCTAssertEqual(duplicateTransferEntries.count, 0)
        XCTAssertEqual(
            2,
            try database.core.scalarInt(
                sql: """
                SELECT COUNT(*)
                FROM media_transfer_queue
                WHERE workspace_id = ? AND media_asset_id = ? AND kind = 'upload'
                """,
                values: [
                    .text(workspace.workspaceId),
                    .text(mediaAssetId)
                ]
            )
        )
        XCTAssertEqual(
            1,
            try database.core.scalarInt(
                sql: """
                SELECT COUNT(*)
                FROM media_transfer_queue
                WHERE workspace_id = ? AND media_asset_id = ? AND kind = 'upload' AND status = 'pending'
                """,
                values: [
                    .text(workspace.workspaceId),
                    .text(mediaAssetId)
                ]
            )
        )

        let bootstrapEntries = try database.loadHotBootstrapEntries(workspaceId: workspace.workspaceId)
        XCTAssertTrue(bootstrapEntries.contains { entry in
            entry.entityType == .card
        })
        XCTAssertFalse(bootstrapEntries.contains { entry in
            entry.entityType == .mediaAsset
        })

        try self.writeMediaCacheFile(
            database: database,
            cacheEntry: cacheEntry,
            data: Data([0x04, 0x03, 0x02, 0x01])
        )
        XCTAssertThrowsError(
            try database.prepareReferencedMediaAssetUploadsForHotBootstrap(workspaceId: workspace.workspaceId)
        ) { error in
            XCTAssertTrue(error.localizedDescription.contains("SHA-256"))
        }
    }

    func testManagedImageAuthoringCreatesLocalCacheAndSaveQueuesTransferForParserSafeMarkdown() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let sourceImageData = try self.tinyTransparentPNGData()

        let result = try authorManagedImage(
            database: database,
            workspaceId: workspace.workspaceId,
            installationId: "installation-1",
            sourceImageData: sourceImageData,
            altText: "source[bracket]\nalt"
        )

        XCTAssertEqual(result.mediaAsset.workspaceId, workspace.workspaceId)
        XCTAssertEqual(result.mediaAsset.mimeType, managedImageMIMEType)
        XCTAssertGreaterThan(result.mediaAsset.sizeBytes, 0)
        XCTAssertEqual(result.mediaAsset.sizeBytes, result.cacheEntry.sizeBytes)
        XCTAssertEqual(result.mediaAsset.sha256, result.cacheEntry.sha256)
        XCTAssertFalse(
            try database.mediaTransferStore.hasUploadTransferMatchingAsset(
                workspaceId: workspace.workspaceId,
                mediaAssetId: result.mediaAsset.mediaAssetId,
                sha256: result.mediaAsset.sha256,
                mimeType: result.mediaAsset.mimeType,
                sizeBytes: result.mediaAsset.sizeBytes
            )
        )

        let storedMediaAsset = try XCTUnwrap(
            try database.loadOptionalMediaAssetIncludingDeleted(
                workspaceId: workspace.workspaceId,
                mediaAssetId: result.mediaAsset.mediaAssetId
            )
        )
        XCTAssertEqual(storedMediaAsset, result.mediaAsset)
        let storedCacheEntry = try XCTUnwrap(
            try database.mediaTransferStore.loadOptionalBlobCacheEntry(sha256: result.mediaAsset.sha256)
        )
        XCTAssertEqual(storedCacheEntry, result.cacheEntry)

        let cacheURL = database.databaseURL
            .deletingLastPathComponent()
            .appendingPathComponent(result.cacheEntry.localRelativePath, isDirectory: false)
        let cachedData = try Data(contentsOf: cacheURL)
        XCTAssertEqual([UInt8](cachedData.prefix(2)), [0xff, 0xd8])
        XCTAssertEqual(Int64(cachedData.count), result.mediaAsset.sizeBytes)

        XCTAssertEqual(
            managedMediaAssetIdsReferencedInMarkdown(text: result.markdown),
            Set([result.mediaAsset.mediaAssetId])
        )
        guard case .managedMarkdown(let renderedContent) = makeReviewRenderedContent(text: result.markdown) else {
            XCTFail("Expected authored managed image Markdown to render as managed media")
            return
        }
        let renderedReferences = renderedContent.blocks.compactMap { block in
            if case .managedMedia(let reference) = block {
                return reference
            }
            return nil
        }
        XCTAssertEqual(renderedReferences.count, 1)
        XCTAssertEqual(renderedReferences.first?.mediaAssetId, result.mediaAsset.mediaAssetId)
        XCTAssertEqual(renderedReferences.first?.isImageSyntax, true)
        let renderedLabel = try XCTUnwrap(renderedReferences.first?.label)
        XCTAssertFalse(renderedLabel.contains("["))
        XCTAssertFalse(renderedLabel.contains("]"))
        XCTAssertFalse(renderedLabel.contains("\n"))

        let savedCard = try database.saveCard(
            workspaceId: workspace.workspaceId,
            input: CardEditorInput(
                frontText: result.markdown,
                backText: "Answer",
                tags: [],
            ),
            cardId: nil,
            mediaAssetIdsReadyForUpload: Set([result.mediaAsset.mediaAssetId])
        )
        XCTAssertEqual(savedCard.frontText, result.markdown)
        XCTAssertTrue(
            try database.mediaTransferStore.hasPendingUploadTransferMatchingAsset(
                workspaceId: workspace.workspaceId,
                mediaAssetId: result.mediaAsset.mediaAssetId,
                sha256: result.mediaAsset.sha256,
                mimeType: result.mediaAsset.mimeType,
                sizeBytes: result.mediaAsset.sizeBytes
            )
        )
    }

    private func makeMediaAsset(workspaceId: String, deletedAt: String?) -> MediaAsset {
        MediaAsset(
            mediaAssetId: "00000000-0000-4000-8000-000000000001",
            workspaceId: workspaceId,
            mimeType: "image/png",
            sizeBytes: 1234,
            sha256: String(repeating: "a", count: 64),
            sourceUrl: nil,
            createdAt: "2026-04-24T10:00:00.000Z",
            clientUpdatedAt: deletedAt == nil ? "2026-04-24T10:00:01.000Z" : "2026-04-25T10:00:00.000Z",
            lastModifiedByReplicaId: "replica-1",
            lastOperationId: deletedAt == nil ? "operation-media-1" : "operation-media-2",
            updatedAt: deletedAt == nil ? "2026-04-24T10:00:02.000Z" : "2026-04-25T10:00:01.000Z",
            deletedAt: deletedAt
        )
    }

    private func tinyTransparentPNGData() throws -> Data {
        let base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        guard let data = Data(base64Encoded: base64) else {
            throw LocalStoreError.validation("Tiny managed image test fixture is invalid")
        }

        return data
    }

    private func writeMediaCacheFile(database: LocalDatabase, cacheEntry: MediaBlobCacheEntry, data: Data) throws {
        let cacheURL = database.databaseURL
            .deletingLastPathComponent()
            .appendingPathComponent(cacheEntry.localRelativePath, isDirectory: false)
        try FileManager.default.createDirectory(
            at: cacheURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil
        )
        try data.write(to: cacheURL, options: [.atomic])
    }

    private func hexSHA256(data: Data) -> String {
        SHA256.hash(data: data).map { byte in
            String(format: "%02x", byte)
        }.joined()
    }
}
