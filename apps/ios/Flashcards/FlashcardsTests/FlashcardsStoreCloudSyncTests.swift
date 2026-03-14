import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class FlashcardsStoreCloudSyncTests: XCTestCase {
    func testSyncCloudIfLinkedNoOpKeepsPublishedReviewStateStable() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try context.store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1", tags: ["tag-a"]),
            editingCardId: nil
        )
        try context.store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2", tags: ["tag-b"]),
            editingCardId: nil
        )
        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let initialReviewQueue = context.store.reviewQueue
        let initialCurrentCardId = context.store.effectiveReviewQueue.first?.cardId
        let initialReadVersion = context.store.localReadVersion

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.store.reviewQueue, initialReviewQueue)
        XCTAssertEqual(context.store.effectiveReviewQueue.first?.cardId, initialCurrentCardId)
        XCTAssertEqual(context.store.localReadVersion, initialReadVersion)
        XCTAssertFalse(context.store.isReviewHeadLoading)
        XCTAssertNil(context.store.reviewOverlayBanner)
    }

    func testSyncCloudIfLinkedShowsOverlayBannerWhenRemoteSyncReplacesCurrentCard() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [
                .succeedWithResult(
                    CloudSyncResult(
                        appliedPullChangeCount: 2,
                        changedEntityTypes: [.card, .reviewEvent],
                        acknowledgedOperationCount: 0,
                        cleanedUpOperationCount: 0
                    )
                )
            ],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try context.store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 1", backText: "Back 1", tags: ["tag-a"]),
            editingCardId: nil
        )
        try context.store.saveCard(
            input: FlashcardsStoreTestSupport.makeCardInput(frontText: "Front 2", backText: "Back 2", tags: ["tag-b"]),
            editingCardId: nil
        )
        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        context.store.cloudRuntime.setActiveCloudSession(
            linkedSession: FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: workspaceId)
        )

        let firstCardId = try XCTUnwrap(context.store.effectiveReviewQueue.first?.cardId)
        let secondCardId = try XCTUnwrap(context.store.effectiveReviewQueue.dropFirst().first?.cardId)
        let initialReadVersion = context.store.localReadVersion

        _ = try context.database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: firstCardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.store.effectiveReviewQueue.first?.cardId, secondCardId)
        XCTAssertEqual(context.store.reviewOverlayBanner?.message, "This review updated on another device.")
        XCTAssertGreaterThan(context.store.localReadVersion, initialReadVersion)
        XCTAssertFalse(context.store.isReviewHeadLoading)
    }

    func testFinishCloudLinkAndParallelSyncCloudIfLinkedShareSingleInitialSyncTask() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: true
        )
        let linkedSession = FlashcardsStoreTestSupport.makeLinkedSession(workspaceId: "remote-workspace")

        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        let finishTask = Task { @MainActor in
            try await context.store.finishCloudLink(linkedSession: linkedSession)
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.store.cloudRuntime.activeCloudSession()?.workspaceId == linkedSession.workspaceId
        }

        let syncTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.cloudSyncService.runLinkedSyncCallCount == 1
        }

        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)

        context.cloudSyncService.resumeRunLinkedSync()
        try await finishTask.value
        await syncTask.value

        let bootstrapSnapshot = try testBootstrapSnapshot(database: context.database)
        XCTAssertEqual(bootstrapSnapshot.workspace.workspaceId, linkedSession.workspaceId)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, linkedSession.workspaceId)
        XCTAssertEqual(context.store.globalErrorMessage, "")
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
    }

    func testParallelSyncCloudIfLinkedCallsCoalesceIntoSingleRestoreFlow() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: true
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        let firstTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }
        let secondTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.cloudSyncService.runLinkedSyncCallCount == 1
        }

        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)

        context.cloudSyncService.resumeRunLinkedSync()
        await firstTask.value
        await secondTask.value

        XCTAssertEqual(context.store.cloudSettings?.cloudState, .linked)
        XCTAssertEqual(context.store.cloudSettings?.linkedWorkspaceId, workspaceId)
        XCTAssertEqual(context.store.globalErrorMessage, "")
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
    }

    func testFailedInitialSyncClearsInFlightLinkTaskAndAllowsRetry() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [
                .fail(message: "Mock sync failure"),
                .succeed,
            ],
            isRunLinkedSyncBlocked: false
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(context.store.globalErrorMessage, "Mock sync failure")
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)

        await context.store.syncCloudIfLinked()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
        XCTAssertEqual(context.store.globalErrorMessage, "")
        XCTAssertNotNil(context.store.lastSuccessfulCloudSyncAt)
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
    }

    func testCancelForAccountDeletionClearsActiveCloudLinkTask() async throws {
        let context = try FlashcardsStoreTestSupport.makeStoreWithMockCloudSyncService(
            testCase: self,
            runLinkedSyncOutcomes: [.succeed],
            isRunLinkedSyncBlocked: true
        )
        let workspaceId = try testWorkspaceId(database: context.database)

        try FlashcardsStoreTestSupport.linkDatabaseWorkspace(
            database: context.database,
            workspaceId: workspaceId
        )
        try context.store.reload()
        try context.store.cloudRuntime.saveCredentials(credentials: FlashcardsStoreTestSupport.makeStoredCloudCredentials())

        let syncTask = Task { @MainActor in
            await context.store.syncCloudIfLinked()
        }

        await FlashcardsStoreTestSupport.waitUntil(
            timeoutNanoseconds: 2_000_000_000,
            pollNanoseconds: 20_000_000
        ) {
            context.cloudSyncService.runLinkedSyncCallCount == 1
        }

        context.store.cloudRuntime.cancelForAccountDeletion()
        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
        XCTAssertNil(context.store.cloudRuntime.activeCloudSession())

        context.cloudSyncService.resumeRunLinkedSync()
        await syncTask.value

        XCTAssertNil(context.store.cloudRuntime.state.activeCloudLinkTask)
        XCTAssertNil(context.store.cloudRuntime.activeCloudSession())
    }
}
