import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunToolCallTrackingBootstrapTests: XCTestCase {
    func testApplyEnvelopeWithActiveRunDoesNotArmToolCallTrackingFromHistoricalMessages() {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        let envelope = AIChatStoreTestSupport.makeConversationEnvelope(
            messages: [
                AIChatStoreTestSupport.makeUserTextMessage(
                    id: "message-0",
                    text: "Run a query.",
                    timestamp: "2026-04-08T09:59:00Z"
                ),
                AIChatMessage(
                    id: "message-1",
                    role: .assistant,
                    content: [
                        .toolCall(
                            AIChatToolCall(
                                id: "tool-1",
                                name: "sql",
                                status: .completed,
                                input: "{\"query\":\"select 1\"}",
                                output: "[]"
                            )
                        )
                    ],
                    timestamp: "2026-04-08T10:00:00Z",
                    isError: false,
                    isStopped: true,
                    cursor: "cursor-1",
                    itemId: "item-1"
                ),
                AIChatStoreTestSupport.makeUserTextMessage(
                    id: "message-2",
                    text: "Summarize it.",
                    timestamp: "2026-04-08T10:00:30Z"
                ),
                AIChatStoreTestSupport.makeAssistantTextMessage(
                    id: "message-3",
                    itemId: "item-3",
                    text: "Here is a plain-text summary.",
                    timestamp: "2026-04-08T10:01:00Z"
                )
            ],
            activeRun: AIChatStoreTestSupport.makeActiveRun()
        )

        store.applyEnvelope(envelope)

        XCTAssertFalse(store.runHadToolCalls)
        XCTAssertFalse(store.hasPendingToolRunPostSync())
    }

    func testApplyBootstrapWithActiveRunDoesNotArmToolCallTrackingFromHistoricalMessages() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let envelope = AIChatStoreTestSupport.makeConversationEnvelope(
            messages: [
                AIChatStoreTestSupport.makeUserTextMessage(
                    id: "message-0",
                    text: "Run a query.",
                    timestamp: "2026-04-08T09:59:00Z"
                ),
                AIChatMessage(
                    id: "message-1",
                    role: .assistant,
                    content: [
                        .toolCall(
                            AIChatToolCall(
                                id: "tool-1",
                                name: "sql",
                                status: .completed,
                                input: "{\"query\":\"select 1\"}",
                                output: "[]"
                            )
                        )
                    ],
                    timestamp: "2026-04-08T10:00:00Z",
                    isError: false,
                    isStopped: true,
                    cursor: "cursor-1",
                    itemId: "item-1"
                ),
                AIChatStoreTestSupport.makeUserTextMessage(
                    id: "message-2",
                    text: "Summarize it.",
                    timestamp: "2026-04-08T10:00:30Z"
                ),
                AIChatStoreTestSupport.makeAssistantTextMessage(
                    id: "message-3",
                    itemId: "item-3",
                    text: "Here is a plain-text summary.",
                    timestamp: "2026-04-08T10:01:00Z"
                )
            ],
            activeRun: AIChatStoreTestSupport.makeActiveRun()
        )

        store.applyBootstrap(envelope)
        await AIChatStoreTestSupport.waitForBackgroundTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.runHadToolCalls)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testApplyBootstrapWithActiveRunTailToolCallDefersSyncUntilRunTerminal() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        let store = context.makeStore()
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after resumed run terminal")
        context.cloudSyncService.syncExpectation = syncExpectation

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [
                    AIChatStoreTestSupport.makeUserTextMessage(
                        id: "message-0",
                        text: "Run a query.",
                        timestamp: "2026-04-08T09:59:00Z"
                    ),
                    AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .started)
                ],
                activeRun: AIChatStoreTestSupport.makeActiveRun()
            )
        )

        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertTrue(store.pendingToolRunPostSync)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)

        store.handleLiveEvent(
            .runTerminal(
                metadata: AIChatLiveEventMetadata(
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    runId: "run-1",
                    cursor: "cursor-2",
                    sequenceNumber: 2,
                    streamEpoch: "epoch-1"
                ),
                outcome: .completed,
                message: nil,
                assistantItemId: "item-1",
                isError: false,
                isStopped: false
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testTerminalRecoveryMessagesArmOneShotToolCallSyncTracking() {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()

        store.markRunHadToolCallsFromMessages(
            messages: [
                AIChatStoreTestSupport.makeUserTextMessage(
                    id: "message-0",
                    text: "Run a query.",
                    timestamp: "2026-04-08T09:59:00Z"
                ),
                AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .started)
            ]
        )

        XCTAssertTrue(store.hasPendingToolRunPostSync())
        store.completeToolRunPostSyncAfterSuccess()
        XCTAssertFalse(store.hasPendingToolRunPostSync())
    }

    func testHandleLiveEventMarksRunWhenToolCallStarts() {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        let activeRun = AIChatStoreTestSupport.makeActiveRun()
        let envelope = AIChatStoreTestSupport.makeConversationEnvelope(
            messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
            activeRun: activeRun
        )
        AIChatStoreTestSupport.setAISurfaceVisibility(store: store, isVisible: true)
        store.applyEnvelope(envelope)
        store.resetRunToolCallTracking()

        store.handleLiveEvent(
            .assistantToolCall(
                metadata: AIChatLiveEventMetadata(
                    sessionId: envelope.sessionId,
                    conversationScopeId: envelope.conversationScopeId,
                    runId: activeRun.runId,
                    cursor: "cursor-2",
                    sequenceNumber: 2,
                    streamEpoch: "epoch-1"
                ),
                toolCall: AIChatToolCall(
                    id: "tool-1",
                    name: "sql",
                    status: .started,
                    input: "{\"query\":\"select 1\"}",
                    output: nil
                ),
                itemId: "item-1"
            )
        )

        XCTAssertTrue(store.runHadToolCalls)
        XCTAssertTrue(store.pendingToolRunPostSync)
    }
}
