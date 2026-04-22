import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunStartTests: XCTestCase {
    func testSendMessageAppendsOptimisticTurnBeforeAsyncPreparationCompletes() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let syncGate = AIChatStoreTestSupport.AsyncGate()
        context.cloudSyncService.runLinkedSyncGate = syncGate
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.inputText = "Help me review this card."
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId else {
                throw LocalStoreError.validation("Expected a chat session id while starting the run.")
            }

            return AIChatStoreTestSupport.makeAcceptedStartRunResponse(
                sessionId: sessionId,
                userText: "Help me review this card."
            )
        }

        store.sendMessage()
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[0].role, .user)
        XCTAssertEqual(store.messages[0].content, [.text("Help me review this card.")])
        XCTAssertEqual(store.messages[1].role, .assistant)
        XCTAssertTrue(isOptimisticAIChatStatusContent(content: store.messages[1].content))
        XCTAssertEqual(store.activeStreamingMessageId, store.messages[1].id)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertEqual(store.composerPhase, .preparingSend)
        XCTAssertNotNil(store.activeSendTask)

        await syncGate.release()
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
    }

    func testSendStartRunFailureRestoresPendingRemoteSessionProvisioningState() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.bootstrapPhase = .ready
        store.chatSessionId = "session-explicit"
        store.conversationScopeId = "session-explicit"
        store.requiresRemoteSessionProvisioning = true
        store.inputText = "Help me review this card."
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id while provisioning.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id while starting the run.")
            }

            throw LocalStoreError.validation("AI chat start-run failed.")
        }

        store.sendMessage()
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertEqual(store.chatSessionId, "session-explicit")
        XCTAssertEqual(store.conversationScopeId, "session-explicit")
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)
        XCTAssertEqual(store.inputText, "Help me review this card.")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertNotNil(store.activeAlert)

        let persistedState = context.historyStore.loadState()
        XCTAssertTrue(persistedState.messages.isEmpty)
        XCTAssertEqual(persistedState.chatSessionId, "session-explicit")
    }
}
