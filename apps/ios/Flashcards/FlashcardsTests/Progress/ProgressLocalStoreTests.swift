import Foundation
import XCTest
@testable import Flashcards

final class ProgressLocalStoreTests: ProgressStoreTestCase {
    func testLoadPendingReviewEventPayloadsReturnsOnlyUnsyncedReviewEvents() throws {
        let database = try self.makeDatabase()
        let workspace = try database.workspaceSettingsStore.loadWorkspace()
        let cloudSettings = try database.workspaceSettingsStore.loadCloudSettings()
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

        _ = try database.submitReview(
            workspaceId: workspace.workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: card.cardId,
                rating: .good,
                reviewedAtClient: "2026-04-02T15:50:57.000Z"
            )
        )

        let pendingBeforeDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertEqual(1, pendingBeforeDelete.count)
        XCTAssertEqual("2026-04-02T15:50:57.000Z", pendingBeforeDelete.first?.reviewedAtClient)

        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspace.workspaceId, limit: Int.max)
        try database.deleteOutboxEntries(operationIds: outboxEntries.map(\.operationId))

        let pendingAfterDelete = try database.loadPendingReviewEventPayloads(
            workspaceId: workspace.workspaceId,
            installationId: cloudSettings.installationId
        )

        XCTAssertTrue(pendingAfterDelete.isEmpty)
        XCTAssertEqual(1, try database.loadReviewEvents(workspaceId: workspace.workspaceId).count)
    }
}
