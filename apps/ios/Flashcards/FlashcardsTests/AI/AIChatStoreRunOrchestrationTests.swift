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
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
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

    func testAcceptedActiveRunResponseKeepsOptimisticTurnUsingExplicitStoreState() async throws {
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
            content: [],
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
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
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
    }

    func testRestorePersistedStateRebuildsOptimisticOwnershipFromPlaceholderTail() {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
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

        store.restorePersistedState(
            AIChatPersistedState(
                messages: [
                    optimisticUserMessage,
                    optimisticAssistantMessage
                ],
                chatSessionId: "session-restore",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        let optimisticTurn = store.currentOptimisticOutgoingTurn()
        XCTAssertEqual(optimisticTurn?.userMessage.id, optimisticUserMessage.id)
        XCTAssertEqual(optimisticTurn?.assistantMessage.id, optimisticAssistantMessage.id)
        XCTAssertTrue(store.isOptimisticAssistantPlaceholder(messageId: optimisticAssistantMessage.id))
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
    }

    func testRestoredLiveDeltaReplacesOptimisticPlaceholder() {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
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
        store.restorePersistedState(
            AIChatPersistedState(
                messages: [
                    optimisticUserMessage,
                    optimisticAssistantMessage
                ],
                chatSessionId: "session-restore",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.chatSessionId, "session-restore")
        let activeRun = AIChatStoreTestSupport.makeActiveRun()
        store.shouldKeepLiveAttached = true
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-restore",
                conversationScopeId: "session-restore",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )

        store.handleLiveEvent(
            .assistantDelta(
                metadata: AIChatLiveEventMetadata(
                    sessionId: "session-restore",
                    conversationScopeId: "session-restore",
                    runId: activeRun.runId,
                    cursor: "cursor-2",
                    sequenceNumber: 2,
                    streamEpoch: "epoch-1"
                ),
                text: "Real answer.",
                itemId: "item-restore"
            )
        )

        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[1].id, optimisticAssistantMessage.id)
        XCTAssertEqual(store.messages[1].content, [.text("Real answer.")])
        XCTAssertEqual(store.messages[1].itemId, "item-restore")
        XCTAssertEqual(store.activeStreamingMessageId, optimisticAssistantMessage.id)
        XCTAssertEqual(store.activeStreamingItemId, "item-restore")
        XCTAssertNil(store.currentOptimisticOutgoingTurn())
    }

    func testRestoredEmptyFirstLiveDeltaKeepsOptimisticPlaceholderUntilRenderableTextArrives() {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
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
        store.restorePersistedState(
            AIChatPersistedState(
                messages: [
                    optimisticUserMessage,
                    optimisticAssistantMessage
                ],
                chatSessionId: "session-restore",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        let activeRun = AIChatStoreTestSupport.makeActiveRun()
        store.shouldKeepLiveAttached = true
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-restore",
                conversationScopeId: "session-restore",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )

        store.handleLiveEvent(
            .assistantDelta(
                metadata: AIChatLiveEventMetadata(
                    sessionId: "session-restore",
                    conversationScopeId: "session-restore",
                    runId: activeRun.runId,
                    cursor: "cursor-2",
                    sequenceNumber: 2,
                    streamEpoch: "epoch-1"
                ),
                text: "",
                itemId: "item-restore"
            )
        )

        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[1].id, optimisticAssistantMessage.id)
        XCTAssertEqual(store.messages[1].content, [.text(aiChatOptimisticAssistantStatusText)])
        XCTAssertEqual(store.messages[1].cursor, "cursor-2")
        XCTAssertEqual(store.messages[1].itemId, "item-restore")
        XCTAssertEqual(store.activeStreamingMessageId, optimisticAssistantMessage.id)
        XCTAssertEqual(store.activeStreamingItemId, "item-restore")
        XCTAssertTrue(store.isOptimisticAssistantPlaceholder(messageId: optimisticAssistantMessage.id))

        store.handleLiveEvent(
            .assistantDelta(
                metadata: AIChatLiveEventMetadata(
                    sessionId: "session-restore",
                    conversationScopeId: "session-restore",
                    runId: activeRun.runId,
                    cursor: "cursor-3",
                    sequenceNumber: 3,
                    streamEpoch: "epoch-1"
                ),
                text: "Real answer.",
                itemId: "item-restore"
            )
        )

        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.messages[1].id, optimisticAssistantMessage.id)
        XCTAssertEqual(store.messages[1].content, [.text("Real answer.")])
        XCTAssertEqual(store.messages[1].cursor, "cursor-3")
        XCTAssertEqual(store.messages[1].itemId, "item-restore")
        XCTAssertEqual(store.activeStreamingMessageId, optimisticAssistantMessage.id)
        XCTAssertEqual(store.activeStreamingItemId, "item-restore")
        XCTAssertNil(store.currentOptimisticOutgoingTurn())
    }

    func testStoreInitRehydratesStampedOptimisticPlaceholderOwnership() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()

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
        let stampedOptimisticAssistantMessage = AIChatMessage(
            id: "message-local-assistant",
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: "2026-04-08T10:02:01Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-2",
            itemId: "item-restore"
        )

        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [
                    optimisticUserMessage,
                    stampedOptimisticAssistantMessage
                ],
                chatSessionId: "session-restore",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        let store = context.makeStore()

        XCTAssertTrue(store.isOptimisticAssistantPlaceholder(messageId: stampedOptimisticAssistantMessage.id))
        XCTAssertEqual(store.currentOptimisticOutgoingTurn()?.userMessage.id, optimisticUserMessage.id)
        XCTAssertEqual(store.currentOptimisticOutgoingTurn()?.assistantMessage.id, stampedOptimisticAssistantMessage.id)
        XCTAssertEqual(store.messages.last?.cursor, "cursor-2")
        XCTAssertEqual(store.messages.last?.itemId, "item-restore")
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
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
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
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
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
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
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

    func testNonRenderableTerminalRepairDoesNotPersistOptimisticPlaceholderSplit() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let bootstrapGate = AIChatStoreTestSupport.AsyncGate()
        context.chatService.loadBootstrapGate = bootstrapGate

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
        let activeRun = AIChatStoreTestSupport.makeActiveRun()

        store.messages = [
            baselineMessages[0],
            baselineMessages[1],
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.shouldKeepLiveAttached = true
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-1",
                conversationScopeId: "session-1",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = nil
        store.schedulePersistCurrentState()
        await store.waitForPendingStatePersistence()

        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: canonicalMessages,
                activeRun: nil
            )
        }

        store.handleLiveEvent(
            .assistantMessageDone(
                metadata: AIChatLiveEventMetadata(
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    runId: activeRun.runId,
                    cursor: "cursor-2",
                    sequenceNumber: 2,
                    streamEpoch: "epoch-1"
                ),
                itemId: "item-current",
                content: [],
                isError: false,
                isStopped: false
            )
        )

        let didStartBootstrapRepair = await AIChatStoreTestSupport.waitForCondition(
            description: "non-renderable terminal bootstrap repair started",
            timeout: .seconds(1),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.loadBootstrapSessionIds == ["session-1"]
            }
        )

        XCTAssertTrue(didStartBootstrapRepair)
        XCTAssertTrue(store.isOptimisticAssistantPlaceholder(messageId: optimisticAssistantMessage.id))
        XCTAssertEqual(store.messages.last?.content, [.text(aiChatOptimisticAssistantStatusText)])
        XCTAssertEqual(store.messages.last?.cursor, "cursor-2")
        XCTAssertEqual(store.messages.last?.itemId, "item-current")

        store.handleLiveEvent(
            .runTerminal(
                metadata: AIChatLiveEventMetadata(
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    runId: activeRun.runId,
                    cursor: "cursor-3",
                    sequenceNumber: 3,
                    streamEpoch: "epoch-1"
                ),
                outcome: .completed,
                message: nil,
                assistantItemId: "item-current",
                isError: false,
                isStopped: false
            )
        )
        await store.waitForPendingStatePersistence()

        XCTAssertTrue(store.isOptimisticAssistantPlaceholder(messageId: optimisticAssistantMessage.id))
        XCTAssertEqual(store.messages.last?.content, [.text(aiChatOptimisticAssistantStatusText)])

        let persistedState = context.historyStore.loadState()
        XCTAssertEqual(
            persistedState.messages,
            [baselineMessages[0], baselineMessages[1], optimisticUserMessage, optimisticAssistantMessage]
        )

        let restoredStore = context.makeStore()
        XCTAssertTrue(restoredStore.isOptimisticAssistantPlaceholder(messageId: optimisticAssistantMessage.id))

        await bootstrapGate.release()

        let didApplyCanonicalRepair = await AIChatStoreTestSupport.waitForCondition(
            description: "bootstrap repair applied canonical messages",
            timeout: .seconds(1),
            pollInterval: .milliseconds(10),
            condition: {
                store.messages == canonicalMessages
            }
        )

        XCTAssertTrue(didApplyCanonicalRepair)
        await store.waitForPendingStatePersistence()
    }

    func testFailedLiveFallbackMarksStampedOptimisticPlaceholderAsError() async throws {
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
        let stampedOptimisticAssistantMessage = AIChatMessage(
            id: "message-local-assistant",
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: "2026-04-08T10:02:01Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-2",
            itemId: "item-current"
        )
        let activeRun = AIChatStoreTestSupport.makeActiveRun()

        store.messages = baselineMessages + [
            optimisticUserMessage,
            stampedOptimisticAssistantMessage
        ]
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: stampedOptimisticAssistantMessage.id
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.shouldKeepLiveAttached = true
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-1",
                conversationScopeId: "session-1",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        store.activeStreamingMessageId = stampedOptimisticAssistantMessage.id
        store.activeStreamingItemId = stampedOptimisticAssistantMessage.itemId
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: baselineMessages,
                activeRun: nil
            )
        }

        await store.reconcileFailedLiveStreamTermination(
            sessionId: "session-1",
            fallbackMessage: "AI live stream failed."
        )
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertEqual(store.messages, baselineMessages + [
            optimisticUserMessage,
            AIChatMessage(
                id: stampedOptimisticAssistantMessage.id,
                role: .assistant,
                content: [.text("AI live stream failed.")],
                timestamp: stampedOptimisticAssistantMessage.timestamp,
                isError: true,
                isStopped: false,
                cursor: stampedOptimisticAssistantMessage.cursor,
                itemId: stampedOptimisticAssistantMessage.itemId
            )
        ])
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertFalse(store.isOptimisticAssistantPlaceholder(messageId: stampedOptimisticAssistantMessage.id))
    }

    func testFailedLiveFallbackAnchorsToCurrentOptimisticTurnInsteadOfDuplicateUserText() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let visibleBaselineMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-visible-user",
                text: "Summarize the key point.",
                timestamp: "2026-04-08T10:01:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-visible-assistant",
                itemId: "item-visible",
                text: "Visible answer.",
                timestamp: "2026-04-08T10:01:05Z"
            )
        ]
        let responseMessages = [
            AIChatStoreTestSupport.makeUserTextMessage(
                id: "message-older-user",
                text: "Explain this card.",
                timestamp: "2026-04-08T09:59:00Z"
            ),
            AIChatStoreTestSupport.makeAssistantTextMessage(
                id: "message-older-assistant",
                itemId: "item-older",
                text: "Older duplicate answer.",
                timestamp: "2026-04-08T09:59:05Z"
            )
        ] + visibleBaselineMessages
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
            cursor: "cursor-2",
            itemId: "item-current"
        )
        let activeRun = AIChatStoreTestSupport.makeActiveRun()

        store.messages = visibleBaselineMessages + [
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.shouldKeepLiveAttached = true
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-1",
                conversationScopeId: "session-1",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = optimisticAssistantMessage.itemId
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: responseMessages,
                activeRun: nil
            )
        }

        await store.reconcileFailedLiveStreamTermination(
            sessionId: "session-1",
            fallbackMessage: "AI live stream failed."
        )
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertEqual(store.messages, visibleBaselineMessages + [
            optimisticUserMessage,
            AIChatMessage(
                id: optimisticAssistantMessage.id,
                role: .assistant,
                content: [.text("AI live stream failed.")],
                timestamp: optimisticAssistantMessage.timestamp,
                isError: true,
                isStopped: false,
                cursor: optimisticAssistantMessage.cursor,
                itemId: optimisticAssistantMessage.itemId
            )
        ])
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertFalse(store.isOptimisticAssistantPlaceholder(messageId: optimisticAssistantMessage.id))
    }

    func testFailedLiveFallbackDoesNotMutateStateAfterOptimisticOwnershipChangesDuringBootstrap() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let bootstrapGate = AIChatStoreTestSupport.AsyncGate()
        context.chatService.loadBootstrapGate = bootstrapGate

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
            cursor: "cursor-2",
            itemId: "item-current"
        )
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
        let activeRun = AIChatStoreTestSupport.makeActiveRun()

        store.messages = baselineMessages + [
            optimisticUserMessage,
            optimisticAssistantMessage
        ]
        store.setOptimisticOutgoingTurnState(
            userMessageId: optimisticUserMessage.id,
            assistantMessageId: optimisticAssistantMessage.id
        )
        store.chatSessionId = "session-1"
        store.conversationScopeId = "session-1"
        store.shouldKeepLiveAttached = true
        store.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: "session-1",
                conversationScopeId: "session-1",
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        store.activeStreamingMessageId = optimisticAssistantMessage.id
        store.activeStreamingItemId = optimisticAssistantMessage.itemId
        context.chatService.loadBootstrapHandler = { sessionId in
            XCTAssertEqual(sessionId, "session-1")
            return AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: baselineMessages,
                activeRun: nil
            )
        }

        let reconcileTask = Task {
            await store.reconcileFailedLiveStreamTermination(
                sessionId: "session-1",
                fallbackMessage: "AI live stream failed."
            )
        }

        let didReachBootstrapGate = await AIChatStoreTestSupport.waitForCondition(
            description: "failed-live fallback bootstrap started",
            timeout: .seconds(1),
            pollInterval: .milliseconds(10),
            condition: {
                context.chatService.loadBootstrapSessionIds == ["session-1"]
            }
        )

        XCTAssertTrue(didReachBootstrapGate)

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                sessionId: "session-1",
                messages: canonicalMessages,
                activeRun: nil
            )
        )
        await store.waitForPendingStatePersistence()

        await bootstrapGate.release()
        await reconcileTask.value
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(store.composerPhase, .idle)
        XCTAssertEqual(store.messages, canonicalMessages)
        XCTAssertNil(store.currentOptimisticOutgoingTurn())
        XCTAssertNil(store.activeStreamingMessageId)
        XCTAssertNil(store.activeStreamingItemId)
        XCTAssertEqual(store.messages.last?.isError, false)
        XCTAssertEqual(store.messages.last?.content, [.text("Final answer.")])
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
