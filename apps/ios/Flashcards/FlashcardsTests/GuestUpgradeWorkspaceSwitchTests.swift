import Foundation
import XCTest
@testable import Flashcards

final class GuestUpgradeWorkspaceSwitchTests: LocalWorkspaceSyncTestCase {
    func testSwitchGuestUpgradeToLinkedWorkspaceFromRemoteRejectsPendingGuestOutboxBeforeDeletingGuestWorkspace() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let savedCard = try database.saveCard(
            workspaceId: localWorkspace.workspaceId,
            input: CardEditorInput(
                frontText: "Question",
                backText: "Answer",
                tags: ["guest"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: localWorkspace.workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: ["guest"])
            )
        )
        try database.updateWorkspaceSchedulerSettings(
            workspaceId: localWorkspace.workspaceId,
            desiredRetention: 0.91,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
            maximumIntervalDays: 36500,
            enableFuzz: true
        )
        try self.updateSyncState(
            database: database,
            workspaceId: localWorkspace.workspaceId,
            hotChangeId: 123,
            reviewSequenceId: 456
        )
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)

        XCTAssertThrowsError(
            try database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
                localWorkspaceId: localWorkspace.workspaceId,
                linkedSession: self.makeLinkedSession(workspaceId: "workspace-linked"),
                workspace: CloudWorkspaceSummary(
                    workspaceId: "workspace-linked",
                    name: "Existing workspace",
                    createdAt: "2026-04-01T00:00:00.000Z",
                    isSelected: true
                )
            )
        ) { error in
            XCTAssertTrue(Flashcards.errorMessage(error: error).contains("pending guest outbox entries remain"))
        }

        XCTAssertEqual(localWorkspace.workspaceId, try database.workspaceSettingsStore.loadWorkspace().workspaceId)
        XCTAssertEqual(1, try self.loadWorkspaceIds(database: database).count)
        XCTAssertTrue(try database.loadActiveCards(workspaceId: localWorkspace.workspaceId).contains { card in
            card.cardId == savedCard.cardId
        })
        XCTAssertGreaterThan(try self.loadOutboxCount(database: database), 0)
        XCTAssertEqual(
            WorkspaceSyncStateSnapshot(
                workspaceId: localWorkspace.workspaceId,
                lastAppliedHotChangeId: 123,
                lastAppliedReviewSequenceId: 456,
                hasHydratedHotState: true,
                hasHydratedReviewHistory: true
            ),
            try self.loadSyncState(database: database, workspaceId: localWorkspace.workspaceId)
        )
    }

    func testSwitchGuestUpgradeToLinkedWorkspaceFromRemotePreservesLinkedOutboxOnResume() throws {
        let database = try self.makeDatabase()
        let localWorkspace = try database.workspaceSettingsStore.loadWorkspace()
        let linkedSession = self.makeLinkedSession(workspaceId: "workspace-linked")
        let linkedWorkspace = CloudWorkspaceSummary(
            workspaceId: "workspace-linked",
            name: "Existing workspace",
            createdAt: "2026-04-01T00:00:00.000Z",
            isSelected: true
        )

        try database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
            localWorkspaceId: localWorkspace.workspaceId,
            linkedSession: linkedSession,
            workspace: linkedWorkspace
        )
        try self.updateSyncState(
            database: database,
            workspaceId: "workspace-linked",
            hotChangeId: 789,
            reviewSequenceId: 987
        )
        let savedLinkedCard = try database.saveCard(
            workspaceId: "workspace-linked",
            input: CardEditorInput(
                frontText: "Linked question",
                backText: "Linked answer",
                tags: ["linked"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        let outboxRowsBeforeResume = try self.loadOutboxRows(database: database)
        XCTAssertTrue(outboxRowsBeforeResume.contains { row in row.entityId == savedLinkedCard.cardId })

        try database.switchGuestUpgradeToLinkedWorkspaceFromRemote(
            localWorkspaceId: "workspace-linked",
            linkedSession: linkedSession,
            workspace: linkedWorkspace
        )

        let outboxRowsAfterResume = try self.loadOutboxRows(database: database)
        XCTAssertEqual(outboxRowsBeforeResume.count, outboxRowsAfterResume.count)
        XCTAssertTrue(outboxRowsAfterResume.contains { row in row.entityId == savedLinkedCard.cardId })
        XCTAssertEqual(1, try database.loadActiveCards(workspaceId: "workspace-linked").count)
        XCTAssertEqual(
            WorkspaceSyncStateSnapshot(
                workspaceId: "workspace-linked",
                lastAppliedHotChangeId: 789,
                lastAppliedReviewSequenceId: 987,
                hasHydratedHotState: true,
                hasHydratedReviewHistory: true
            ),
            try self.loadSyncState(database: database, workspaceId: "workspace-linked")
        )
    }
}
