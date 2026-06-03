import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningGuestBootstrapTests: XCTestCase {
    func testGuestBootstrapRetryReusesSameExplicitSessionIdBeforeLoadingBootstrap() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        var createAttempts: Int = 0
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            createAttempts += 1
            if createAttempts == 1 {
                throw URLError(.networkConnectionLost)
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap load.")
            }
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.events, [
            "createNewSession:\(explicitSessionId)",
            "createNewSession:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.bootstrapPhase, .ready)
    }

    func testGuestBootstrapRetryRerunsFailedSetupSyncBeforeProvisioning() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        context.flashcardsStore.syncStatus = .failed(message: "Previous guest setup sync failed.")
        context.cloudSyncService.runLinkedSyncErrors = [URLError(.timedOut)]
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id after guest setup sync retry.")
            }
            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap load.")
            }
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [explicitSessionId])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.bootstrapPhase, .ready)
    }

}
