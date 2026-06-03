import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRemoteSessionProvisioningContractMismatchTests: XCTestCase {
    func testLinkedBootstrapSessionContractMismatchFailsClosedWithoutRetrying() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before bootstrap validation.")
            }

            return AIChatStoreTestSupport.makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let requestedSessionId = sessionId, requestedSessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during bootstrap validation.")
            }

            return makeBootstrapResponse(
                sessionId: "wrong-\(requestedSessionId)",
                conversationScopeId: "wrong-\(requestedSessionId)",
                messageText: "Wrong conversation",
                activeRun: AIChatStoreTestSupport.makeActiveRun()
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
        XCTAssertEqual(store.conversationScopeId, explicitSessionId)
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertNil(store.activeRunId)
        XCTAssertEqual(store.composerPhase, .idle)
        guard case .failed = store.bootstrapPhase else {
            XCTFail("Expected failed bootstrap phase for a session contract mismatch.")
            return
        }
    }

    func testCanonicalReloadSessionContractMismatchDoesNotSwitchConversation() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        let expectedMessage = AIChatStoreTestSupport.makeAssistantTextMessage(
            id: "message-current",
            itemId: "item-current",
            text: "Current conversation",
            timestamp: "2026-04-08T10:00:00Z"
        )
        store.messages = [expectedMessage]
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return makeBootstrapResponse(
                sessionId: "session-2",
                conversationScopeId: "session-2",
                messageText: "Wrong canonical conversation",
                activeRun: nil
            )
        }

        store.reloadCanonicalConversationAfterAcceptedTerminalEnvelope()
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, ["session-1"])
        XCTAssertEqual(store.chatSessionId, "session-1")
        XCTAssertEqual(store.conversationScopeId, "session-1")
        XCTAssertEqual(store.messages, [expectedMessage])
        XCTAssertNil(store.activeRunId)
        XCTAssertNotNil(store.activeAlert)
    }

    func testPassiveBootstrapRefreshSessionContractMismatchDoesNotSwitchConversation() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        let expectedMessage = AIChatStoreTestSupport.makeAssistantTextMessage(
            id: "message-current",
            itemId: "item-current",
            text: "Current passive conversation",
            timestamp: "2026-04-08T10:00:00Z"
        )
        store.messages = [expectedMessage]
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return makeBootstrapResponse(
                sessionId: "session-2",
                conversationScopeId: "session-2",
                messageText: "Wrong passive conversation",
                activeRun: AIChatStoreTestSupport.makeActiveRun()
            )
        }

        store.startPassiveSnapshotRefreshIfPossible()
        let didLoadBootstrap = await AIChatStoreTestSupport.waitForCondition(
            description: "passive bootstrap refresh loaded",
            timeout: .seconds(3),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.loadBootstrapSessionIds.count == 1
            }
        )
        XCTAssertTrue(didLoadBootstrap)
        try await Task.sleep(for: .milliseconds(100))

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, ["session-1"])
        XCTAssertEqual(store.chatSessionId, "session-1")
        XCTAssertEqual(store.conversationScopeId, "session-1")
        XCTAssertEqual(store.messages, [expectedMessage])
        XCTAssertNil(store.activeRunId)
        XCTAssertEqual(store.bootstrapPhase, .ready)
    }
}

private func makeBootstrapResponse(
    sessionId: String,
    conversationScopeId: String,
    messageText: String,
    activeRun: AIChatActiveRun?
) -> AIChatBootstrapResponse {
    AIChatBootstrapResponse(
        sessionId: sessionId,
        conversationScopeId: conversationScopeId,
        conversation: AIChatConversation(
            messages: [
                AIChatStoreTestSupport.makeAssistantTextMessage(
                    id: "message-wrong",
                    itemId: "item-wrong",
                    text: messageText,
                    timestamp: "2026-04-08T10:00:00Z"
                )
            ],
            updatedAt: 1,
            mainContentInvalidationVersion: 1,
            hasOlder: false,
            oldestCursor: nil
        ),
        composerSuggestions: [],
        chatConfig: aiChatDefaultServerConfig,
        activeRun: activeRun
    )
}
