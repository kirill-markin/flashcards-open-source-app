import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunRestorationTests: XCTestCase {
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
            content: [],
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
            content: [],
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
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
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
            content: [],
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
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
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
        XCTAssertEqual(store.messages[1].content, [])
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
            content: [],
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
}
