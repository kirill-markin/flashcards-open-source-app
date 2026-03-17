import Foundation
import XCTest
@testable import Flashcards

final class LocalDatabaseWorkspaceLinkingTests: XCTestCase {
    func testRelinkWorkspaceMovesLocalDataIntoLinkedWorkspace() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let localWorkspaceId = try testWorkspaceId(database: database)
        let savedCard = try database.saveCard(
            workspaceId: localWorkspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let savedDeck = try database.createDeck(
            workspaceId: localWorkspaceId,
            input: LocalDatabaseTestSupport.makeDeckInput(name: "Deck")
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: localWorkspaceId,
            desiredRetention: 0.91,
            learningStepsMinutes: [2, 12],
            relearningStepsMinutes: [15],
            maximumIntervalDays: 400,
            enableFuzz: false
        )

        let linkedSession = FlashcardsStoreTestSupport.makeLinkedSession(
            userId: "user-linked",
            workspaceId: "workspace-linked",
            email: "linked@example.com"
        )

        try database.relinkWorkspace(localWorkspaceId: localWorkspaceId, linkedSession: linkedSession)

        let bootstrapSnapshot = try testBootstrapSnapshot(database: database)
        XCTAssertEqual(bootstrapSnapshot.workspace.workspaceId, linkedSession.workspaceId)
        XCTAssertEqual(bootstrapSnapshot.workspace.name, "Personal")
        XCTAssertEqual(bootstrapSnapshot.userSettings.workspaceId, linkedSession.workspaceId)
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.desiredRetention, 0.91)
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.learningStepsMinutes, [2, 12])
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.relearningStepsMinutes, [15])
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.maximumIntervalDays, 400)
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.enableFuzz, false)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.cloudState, .linked)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.linkedUserId, linkedSession.userId)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.linkedWorkspaceId, linkedSession.workspaceId)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.linkedEmail, linkedSession.email)

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].cardId, savedCard.cardId)
        XCTAssertEqual(cards[0].workspaceId, linkedSession.workspaceId)

        let decks = try testActiveDecks(database: database)
        XCTAssertEqual(decks.count, 1)
        XCTAssertEqual(decks[0].deckId, savedDeck.deckId)
        XCTAssertEqual(decks[0].workspaceId, linkedSession.workspaceId)

        XCTAssertEqual(
            try self.workspaceIds(database: database),
            [linkedSession.workspaceId]
        )
        XCTAssertEqual(try database.loadLastAppliedChangeId(workspaceId: linkedSession.workspaceId), 0)
    }

    func testReplaceLocalWorkspaceAfterRemoteDeleteUsesReplacementWorkspaceAndClearsLocalData() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let localWorkspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: localWorkspaceId,
            input: LocalDatabaseTestSupport.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: localWorkspaceId,
            input: LocalDatabaseTestSupport.makeDeckInput(name: "Deck")
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: localWorkspaceId,
            desiredRetention: 0.93,
            learningStepsMinutes: [3, 30],
            relearningStepsMinutes: [20],
            maximumIntervalDays: 365,
            enableFuzz: false
        )

        let localSettings = try testSchedulerSettings(database: database)
        let replacementWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-replacement",
            name: "Replacement",
            createdAt: "2026-03-17T10:00:00.000Z",
            isSelected: true
        )
        try self.insertWorkspace(
            database: database,
            workspaceId: replacementWorkspace.workspaceId,
            name: "Stale name",
            createdAt: "2026-03-01T10:00:00.000Z",
            settings: localSettings
        )
        try database.core.execute(
            sql: """
            INSERT INTO sync_state (workspace_id, last_applied_change_id, updated_at)
            VALUES (?, ?, ?)
            """,
            values: [
                .text(replacementWorkspace.workspaceId),
                .integer(99),
                .text(nowIsoTimestamp())
            ]
        )

        let linkedSession = FlashcardsStoreTestSupport.makeLinkedSession(
            userId: "user-linked",
            workspaceId: "workspace-original-remote",
            email: "linked@example.com"
        )

        try database.replaceLocalWorkspaceAfterRemoteDelete(
            localWorkspaceId: localWorkspaceId,
            replacementWorkspace: replacementWorkspace,
            linkedSession: linkedSession
        )

        let bootstrapSnapshot = try testBootstrapSnapshot(database: database)
        XCTAssertEqual(bootstrapSnapshot.workspace.workspaceId, replacementWorkspace.workspaceId)
        XCTAssertEqual(bootstrapSnapshot.workspace.name, replacementWorkspace.name)
        XCTAssertEqual(bootstrapSnapshot.workspace.createdAt, replacementWorkspace.createdAt)
        XCTAssertEqual(bootstrapSnapshot.userSettings.workspaceId, replacementWorkspace.workspaceId)
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.desiredRetention, 0.93)
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.learningStepsMinutes, [3, 30])
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.relearningStepsMinutes, [20])
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.maximumIntervalDays, 365)
        XCTAssertEqual(bootstrapSnapshot.schedulerSettings.enableFuzz, false)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.cloudState, .linked)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.linkedUserId, linkedSession.userId)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.linkedWorkspaceId, replacementWorkspace.workspaceId)
        XCTAssertEqual(bootstrapSnapshot.cloudSettings.linkedEmail, linkedSession.email)

        XCTAssertTrue(try testActiveCards(database: database).isEmpty)
        XCTAssertTrue(try testActiveDecks(database: database).isEmpty)
        XCTAssertTrue(try database.loadOutboxEntries(workspaceId: replacementWorkspace.workspaceId, limit: 100).isEmpty)
        XCTAssertEqual(try database.loadLastAppliedChangeId(workspaceId: replacementWorkspace.workspaceId), 0)
        XCTAssertEqual(
            try self.workspaceIds(database: database),
            [replacementWorkspace.workspaceId]
        )
    }

    private func workspaceIds(database: LocalDatabase) throws -> [String] {
        try database.core.query(
            sql: """
            SELECT workspace_id
            FROM workspaces
            ORDER BY workspace_id ASC
            """,
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }
    }

    private func insertWorkspace(
        database: LocalDatabase,
        workspaceId: String,
        name: String,
        createdAt: String,
        settings: WorkspaceSchedulerSettings
    ) throws {
        try database.core.execute(
            sql: """
            INSERT INTO workspaces (
                workspace_id,
                name,
                created_at,
                fsrs_algorithm,
                fsrs_desired_retention,
                fsrs_learning_steps_minutes_json,
                fsrs_relearning_steps_minutes_json,
                fsrs_maximum_interval_days,
                fsrs_enable_fuzz,
                fsrs_client_updated_at,
                fsrs_last_modified_by_device_id,
                fsrs_last_operation_id,
                fsrs_updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values: [
                .text(workspaceId),
                .text(name),
                .text(createdAt),
                .text(settings.algorithm),
                .real(settings.desiredRetention),
                .text(try database.workspaceSettingsStore.encodeIntegerArray(values: settings.learningStepsMinutes)),
                .text(try database.workspaceSettingsStore.encodeIntegerArray(values: settings.relearningStepsMinutes)),
                .integer(Int64(settings.maximumIntervalDays)),
                .integer(settings.enableFuzz ? 1 : 0),
                .text(settings.clientUpdatedAt),
                .text(settings.lastModifiedByDeviceId),
                .text(settings.lastOperationId),
                .text(settings.updatedAt)
            ]
        )
    }
}
