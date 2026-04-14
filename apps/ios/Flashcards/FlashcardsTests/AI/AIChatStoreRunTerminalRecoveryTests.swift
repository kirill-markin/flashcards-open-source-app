import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunTerminalRecoveryTests: XCTestCase {
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
            content: [],
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
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
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
        XCTAssertEqual(store.messages.last?.content, [])
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
        XCTAssertEqual(store.messages.last?.content, [])

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
            content: [],
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
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
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
            content: [],
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
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
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
            content: [],
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
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
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
}
