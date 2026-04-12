import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunOrchestrationTests: XCTestCase {
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

        let didReachPreflightGate = await AIChatStoreTestSupport.waitForCondition(
            description: "AI chat send preflight gate",
            timeout: .seconds(1),
            pollInterval: .milliseconds(10),
            condition: {
                context.cloudSyncService.runLinkedSyncCallCount == 1 && store.activeSendTask != nil
            }
        )

        XCTAssertTrue(didReachPreflightGate)
        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[0].role, .user)
        XCTAssertEqual(store.messages[0].content, [.text("Help me review this card.")])
        XCTAssertEqual(store.messages[1].role, .assistant)
        XCTAssertTrue(isOptimisticAIChatStatusContent(content: store.messages[1].content))
        XCTAssertEqual(store.activeStreamingMessageId, store.messages[1].id)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertEqual(store.composerPhase, .preparingSend)

        await syncGate.release()
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
    }

    func testAcceptedActiveRunResponseKeepsOptimisticTurnWhenSnapshotIsStale() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let baselineMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-previous-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T10:01:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-previous-assistant",
                itemId: "item-previous",
                text: "Earlier answer.",
                timestamp: "2026-04-08T10:01:05Z"
            )
        ]
        let optimisticUserMessage = AIChatMessage(
            id: "message-local-user",
            role: .user,
            content: [.text("Explain this card.")],
            timestamp: "2026-04-08T10:02:00Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        let optimisticAssistantMessage = AIChatMessage(
            id: "message-local-assistant",
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: "2026-04-08T10:02:01Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        store.messages = [
            baselineMessages[0],
            baselineMessages[1],
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.activeConversationId = "conversation-1"
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = nil
        store.inputText = "Explain this card."
        store.transitionToStartingRun()
        store.storePreSendSnapshot(
            AIChatPreSendSnapshot(
                persistedState: AIChatPersistedState(
                    messages: baselineMessages,
                    chatSessionId: "session-1",
                    lastKnownChatConfig: aiChatDefaultServerConfig,
                    pendingToolRunPostSync: false
                ),
                requiresRemoteSessionProvisioning: false,
                outgoingContent: [.text("Explain this card.")]
            ),
            conversationId: "conversation-1"
        )

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: baselineMessages,
                        updatedAt: 1,
                        mainContentInvalidationVersion: 1,
                        hasOlder: false,
                        oldestCursor: nil
                    ),
                    composerSuggestions: [],
                    chatConfig: aiChatDefaultServerConfig,
                    activeRun: AIChatStoreTestSupport.makeActiveRun(),
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.messages, [
            baselineMessages[0],
            baselineMessages[1],
            optimisticUserMessage,
            optimisticAssistantMessage
        ])
        XCTAssertEqual(store.activeStreamingMessageId, optimisticAssistantMessage.id)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertEqual(store.activeRunId, "run-1")
        XCTAssertEqual(store.composerPhase, .running)
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
    }

    func testAcceptedActiveRunResponseIgnoresRecoveredOlderDuplicateUserContentBeforeBaselineAnchor() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let baselineMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-baseline-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T10:01:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-baseline-assistant",
                itemId: "item-baseline",
                text: "Baseline answer.",
                timestamp: "2026-04-08T10:01:05Z"
            )
        ]
        let recoveredOlderMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-older-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T09:59:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-older-assistant",
                itemId: "item-older",
                text: "Older answer.",
                timestamp: "2026-04-08T09:59:05Z"
            )
        ]
        let optimisticUserMessage = AIChatMessage(
            id: "message-local-user",
            role: .user,
            content: [.text("Explain this card.")],
            timestamp: "2026-04-08T10:02:00Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        let optimisticAssistantMessage = AIChatMessage(
            id: "message-local-assistant",
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: "2026-04-08T10:02:01Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        store.messages = baselineMessages + [
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.activeConversationId = "conversation-1"
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = nil
        store.inputText = "Explain this card."
        store.transitionToStartingRun()
        store.storePreSendSnapshot(
            AIChatPreSendSnapshot(
                persistedState: AIChatPersistedState(
                    messages: baselineMessages,
                    chatSessionId: "session-1",
                    lastKnownChatConfig: aiChatDefaultServerConfig,
                    pendingToolRunPostSync: false
                ),
                requiresRemoteSessionProvisioning: false,
                outgoingContent: [.text("Explain this card.")]
            ),
            conversationId: "conversation-1"
        )

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: recoveredOlderMessages + baselineMessages,
                        updatedAt: 1,
                        mainContentInvalidationVersion: 1,
                        hasOlder: true,
                        oldestCursor: "cursor-older"
                    ),
                    composerSuggestions: [],
                    chatConfig: aiChatDefaultServerConfig,
                    activeRun: AIChatStoreTestSupport.makeActiveRun(),
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.messages, baselineMessages + [
            optimisticUserMessage,
            optimisticAssistantMessage
        ])
        XCTAssertEqual(store.activeStreamingMessageId, optimisticAssistantMessage.id)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertEqual(store.activeRunId, "run-1")
        XCTAssertEqual(store.composerPhase, .running)
    }

    func testAcceptedActiveRunResponseAppliesCanonicalEnvelopeWhenServerTimestampPrecedesOptimisticTimestamp() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let baselineMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-previous-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T10:01:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-previous-assistant",
                itemId: "item-previous",
                text: "Earlier answer.",
                timestamp: "2026-04-08T10:01:05Z"
            )
        ]
        let optimisticUserMessage = AIChatMessage(
            id: "message-local-user",
            role: .user,
            content: [.text("Explain this card.")],
            timestamp: "2026-04-08T10:02:00Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        let optimisticAssistantMessage = AIChatMessage(
            id: "message-local-assistant",
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: "2026-04-08T10:02:01Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        let acceptedMessages = baselineMessages + [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-current-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T10:01:30Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-current-assistant-1",
                itemId: "item-current-1",
                text: "Let me reason through it.",
                timestamp: "2026-04-08T10:01:31Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-current-assistant-2",
                itemId: "item-current-2",
                text: "Here is the key idea.",
                timestamp: "2026-04-08T10:01:32Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-current-assistant-3",
                itemId: "item-current-3",
                text: "Now apply it to this card.",
                timestamp: "2026-04-08T10:01:33Z"
            )
        ]
        store.messages = [
            baselineMessages[0],
            baselineMessages[1],
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.activeConversationId = "conversation-1"
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = nil
        store.inputText = "Explain this card."
        store.transitionToStartingRun()
        store.storePreSendSnapshot(
            AIChatPreSendSnapshot(
                persistedState: AIChatPersistedState(
                    messages: baselineMessages,
                    chatSessionId: "session-1",
                    lastKnownChatConfig: aiChatDefaultServerConfig,
                    pendingToolRunPostSync: false
                ),
                requiresRemoteSessionProvisioning: false,
                outgoingContent: [.text("Explain this card.")]
            ),
            conversationId: "conversation-1"
        )

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: acceptedMessages,
                        updatedAt: 1,
                        mainContentInvalidationVersion: 1,
                        hasOlder: false,
                        oldestCursor: nil
                    ),
                    composerSuggestions: [],
                    chatConfig: aiChatDefaultServerConfig,
                    activeRun: AIChatStoreTestSupport.makeActiveRun(),
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.messages, acceptedMessages)
        XCTAssertEqual(store.activeStreamingMessageId, "message-current-assistant-3")
        XCTAssertEqual(store.activeStreamingItemId, "item-current-3")
        XCTAssertEqual(store.activeRunId, "run-1")
        XCTAssertEqual(store.composerPhase, .running)
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
    }

    func testAcceptedTerminalResponseReloadsCanonicalConversationWhenAcceptedSnapshotIsStale() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let baselineMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-previous-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T10:01:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-previous-assistant",
                itemId: "item-previous",
                text: "Earlier answer.",
                timestamp: "2026-04-08T10:01:05Z"
            )
        ]
        let canonicalMessages = baselineMessages + [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-current-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T10:02:10Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-current-assistant",
                itemId: "item-current",
                text: "Final answer.",
                timestamp: "2026-04-08T10:02:11Z"
            )
        ]
        let optimisticUserMessage = AIChatMessage(
            id: "message-local-user",
            role: .user,
            content: [.text("Explain this card.")],
            timestamp: "2026-04-08T10:02:00Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        let optimisticAssistantMessage = AIChatMessage(
            id: "message-local-assistant",
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: "2026-04-08T10:02:01Z",
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        store.messages = [
            baselineMessages[0],
            baselineMessages[1],
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.activeConversationId = "conversation-1"
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = nil
        store.inputText = "Explain this card."
        store.transitionToStartingRun()
        store.storePreSendSnapshot(
            AIChatPreSendSnapshot(
                persistedState: AIChatPersistedState(
                    messages: baselineMessages,
                    chatSessionId: "session-1",
                    lastKnownChatConfig: aiChatDefaultServerConfig,
                    pendingToolRunPostSync: false
                ),
                requiresRemoteSessionProvisioning: false,
                outgoingContent: [.text("Explain this card.")]
            ),
            conversationId: "conversation-1"
        )
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: canonicalMessages,
                activeRun: nil
            )
        }

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: baselineMessages,
                        updatedAt: 1,
                        mainContentInvalidationVersion: 1,
                        hasOlder: false,
                        oldestCursor: nil
                    ),
                    composerSuggestions: [],
                    chatConfig: aiChatDefaultServerConfig,
                    activeRun: nil,
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )
        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, ["session-1"])
        XCTAssertEqual(store.messages, canonicalMessages)
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertNil(store.activeRunId)
        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertEqual(store.inputText, "")
        XCTAssertTrue(store.pendingAttachments.isEmpty)
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
        await AIChatStoreTestSupport.waitForSendToSettle(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.chatService.createNewSessionRequests.count, 1)
        XCTAssertEqual(context.chatService.startRunRequests.count, 1)
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
