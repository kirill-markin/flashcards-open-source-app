import Foundation
import XCTest
@testable import Flashcards

final class LocalWorkspaceLinkMigrationTests: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func testMigrateLocalWorkspaceToLinkedWorkspaceReplacesLocalShellForNonEmptyRemoteWorkspace() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: [],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: localWorkspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )

        try database.migrateLocalWorkspaceToLinkedWorkspace(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
            remoteWorkspaceIsEmpty: false
        )

        XCTAssertEqual("workspace-linked", try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: "workspace-linked").isEmpty)
        XCTAssertTrue(try database.loadReviewEvents(workspaceId: "workspace-linked").isEmpty)
        XCTAssertEqual(0, try self.loadOutboxCount(database: database))
        XCTAssertNil(try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId))
        XCTAssertEqual(
            SyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 0,
                lastAppliedReviewSequenceId: 0,
                hasHydratedHotState: false,
                hasHydratedReviewHistory: false
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }

    func testMigrateLocalWorkspaceToLinkedWorkspacePreservesLocalDataForEmptyRemoteWorkspaceButResetsSyncState() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["tag"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.submitReview(
            workspaceId: localWorkspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )

        try database.migrateLocalWorkspaceToLinkedWorkspace(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
            remoteWorkspaceIsEmpty: true
        )

        let migratedCards = try database.loadActiveCards(workspaceId: "workspace-linked")
        let migratedReviewEvents = try database.loadReviewEvents(workspaceId: "workspace-linked")
        let migratedCard = try XCTUnwrap(migratedCards.first)
        let migratedReviewEvent = try XCTUnwrap(migratedReviewEvents.first)
        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertEqual(savedCard.cardId, migratedCard.cardId)
        XCTAssertEqual("workspace-linked", migratedCard.workspaceId)
        XCTAssertEqual(1, migratedReviewEvents.count)
        XCTAssertEqual("workspace-linked", migratedReviewEvent.workspaceId)
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertNil(try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId))
        XCTAssertEqual(
            SyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 0,
                lastAppliedReviewSequenceId: 0,
                hasHydratedHotState: false,
                hasHydratedReviewHistory: false
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }

    private func makeDatabase() throws -> LocalDatabase {
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    private func makeLinkedSession(workspaceId: String) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-1",
            workspaceId: workspaceId,
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
            authorization: .bearer("id-token")
        )
    }

    private func updateSyncState(
        database: LocalDatabase,
        workspaceId: String,
        hotChangeId: Int64,
        reviewSequenceId: Int64
    ) throws {
        _ = try database.core.execute(
            sql: """
            UPDATE sync_state
            SET
                last_applied_hot_change_id = ?,
                last_applied_review_sequence_id = ?,
                has_hydrated_hot_state = 1,
                has_hydrated_review_history = 1,
                updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(hotChangeId),
                .integer(reviewSequenceId),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    private func loadWorkspaceIds(database: LocalDatabase) throws -> [String] {
        try database.core.query(
            sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC",
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }
    }

    private func loadOutboxCount(database: LocalDatabase) throws -> Int {
        Int(try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM outbox",
            values: []
        ))
    }

    private func loadSyncState(database: LocalDatabase, workspaceId: String) throws -> SyncStateSnapshot? {
        try database.core.query(
            sql: """
            SELECT
                workspace_id,
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history
            FROM sync_state
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            SyncStateSnapshot(
                workspaceId: DatabaseCore.columnText(statement: statement, index: 0),
                lastAppliedHotChangeId: DatabaseCore.columnInt64(statement: statement, index: 1),
                lastAppliedReviewSequenceId: DatabaseCore.columnInt64(statement: statement, index: 2),
                hasHydratedHotState: DatabaseCore.columnInt64(statement: statement, index: 3) == 1,
                hasHydratedReviewHistory: DatabaseCore.columnInt64(statement: statement, index: 4) == 1
            )
        }.first
    }
}

private struct SyncStateSnapshot: Equatable {
    let workspaceId: String
    let lastAppliedHotChangeId: Int64
    let lastAppliedReviewSequenceId: Int64
    let hasHydratedHotState: Bool
    let hasHydratedReviewHistory: Bool
}
