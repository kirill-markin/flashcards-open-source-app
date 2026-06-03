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
        XCTAssertTrue(try self.hasColumn(database: database, tableName: "outbox", columnName: "review_schedule_impact"))
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_due_millis_active"
            )
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_new_due_active"
            )
        )
        XCTAssertTrue(
            try self.hasIndex(
                database: database,
                tableName: "cards",
                indexName: "idx_cards_workspace_fsrs_last_reviewed_millis_due_active"
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
                effortLevel: .medium
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
                reviewedAtClient: formatIsoTimestamp(date: reviewTime)
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
                effortLevel: .medium
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
}
