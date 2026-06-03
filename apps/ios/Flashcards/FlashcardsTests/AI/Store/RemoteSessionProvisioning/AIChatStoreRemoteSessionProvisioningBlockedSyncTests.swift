import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningBlockedSyncTests: XCTestCase {
    func testBlockedCloudSyncBootstrapShowsAccountStatusMessageWithReasonDetails() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        let blockedMessage = "Sync is blocked until account status is resolved."
        context.flashcardsStore.syncStatus = .blocked(message: blockedMessage)

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertTrue(context.chatService.events.isEmpty)
        XCTAssertNil(store.activeAlert)
        guard case .failed(let presentation) = store.bootstrapPhase else {
            XCTFail("Expected failed bootstrap state for blocked sync.")
            return
        }
        XCTAssertEqual(
            presentation.message,
            "AI chat needs your cloud account status to be resolved before it can load."
        )
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)
        XCTAssertTrue(technicalDetails.contains("Type: LocalStoreError"))
        XCTAssertTrue(technicalDetails.contains("Reason: \(blockedMessage)"))
    }

}
