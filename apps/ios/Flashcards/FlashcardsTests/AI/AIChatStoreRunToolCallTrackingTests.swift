import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunToolCallTrackingTests: XCTestCase {
    func testApplyEnvelopeWithActiveRunDoesNotArmToolCallTrackingFromHistoricalMessages() {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        let envelope = makeConversationEnvelope(
            messages: [
                makeUserTextMessage(
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
                makeUserTextMessage(
                    id: "message-2",
                    text: "Summarize it.",
                    timestamp: "2026-04-08T10:00:30Z"
                ),
                makeAssistantTextMessage(
                    id: "message-3",
                    itemId: "item-3",
                    text: "Here is a plain-text summary.",
                    timestamp: "2026-04-08T10:01:00Z"
                )
            ],
            activeRun: makeActiveRun()
        )

        store.applyEnvelope(envelope)

        XCTAssertFalse(store.runHadToolCalls)
        XCTAssertFalse(store.hasPendingToolRunPostSync())
    }

    func testApplyBootstrapWithActiveRunDoesNotArmToolCallTrackingFromHistoricalMessages() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let envelope = makeConversationEnvelope(
            messages: [
                makeUserTextMessage(
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
                makeUserTextMessage(
                    id: "message-2",
                    text: "Summarize it.",
                    timestamp: "2026-04-08T10:00:30Z"
                ),
                makeAssistantTextMessage(
                    id: "message-3",
                    itemId: "item-3",
                    text: "Here is a plain-text summary.",
                    timestamp: "2026-04-08T10:01:00Z"
                )
            ],
            activeRun: makeActiveRun()
        )

        store.applyBootstrap(envelope)
        await waitForBackgroundAIChatTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.runHadToolCalls)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testApplyBootstrapWithActiveRunTailToolCallDefersSyncUntilRunTerminal() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        let store = context.makeStore()
        store.shouldKeepLiveAttached = true
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after resumed run terminal")
        context.cloudSyncService.syncExpectation = syncExpectation

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [
                    makeUserTextMessage(
                        id: "message-0",
                        text: "Run a query.",
                        timestamp: "2026-04-08T09:59:00Z"
                    ),
                    makeAssistantToolCallMessage(toolCallStatus: .started)
                ],
                activeRun: makeActiveRun()
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
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()

        store.markRunHadToolCallsFromMessages(
            messages: [
                makeUserTextMessage(
                    id: "message-0",
                    text: "Run a query.",
                    timestamp: "2026-04-08T09:59:00Z"
                ),
                makeAssistantToolCallMessage(toolCallStatus: .started)
            ]
        )

        XCTAssertTrue(store.hasPendingToolRunPostSync())
        store.completeToolRunPostSyncAfterSuccess()
        XCTAssertFalse(store.hasPendingToolRunPostSync())
    }

    func testHandleLiveEventMarksRunWhenToolCallStarts() {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        let store = context.makeStore()
        let activeRun = makeActiveRun()
        let envelope = makeConversationEnvelope(
            messages: [makeAssistantTextMessage(itemId: "item-1")],
            activeRun: activeRun
        )
        store.shouldKeepLiveAttached = true
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

    func testBootstrapAfterRelaunchTriggersOneLinkedSyncFromPersistedFlag() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after bootstrap")
        context.cloudSyncService.syncExpectation = syncExpectation

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testBootstrapAssistantOnlyTerminalToolCallTriggersOneLinkedSync() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after assistant-only terminal tool call snapshot")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestAsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [
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
                    )
                ],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertTrue(store.pendingToolRunPostSync)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)

        await gate.release()
        await waitForAIChatToolRunPostSyncToSettle(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testBootstrapAssistantOnlyTerminalPlainTextDoesNotArmSyncFromEarlierAssistantItemToolCall() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [
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
                    makeAssistantTextMessage(
                        id: "message-2",
                        itemId: "item-2",
                        text: "Here is a plain-text summary.",
                        timestamp: "2026-04-08T10:00:05Z"
                    )
                ],
                activeRun: nil
            )
        )

        await waitForBackgroundAIChatTasks(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.runHadToolCalls)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testFailedLinkedSyncLeavesPendingFlagPersisted() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started once and failed")
        context.cloudSyncService.syncExpectation = syncExpectation
        context.cloudSyncService.runLinkedSyncErrors = [
            LocalStoreError.validation("Transient linked sync failure.")
        ]

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertTrue(store.pendingToolRunPostSync)
    }

    func testBootstrapAfterFailedLinkedSyncRetriesOnNextLaunchAndClearsPersistedFlag() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let firstStore = context.makeStore()
        let firstSyncExpectation = XCTestExpectation(description: "First linked sync attempt failed")
        context.cloudSyncService.syncExpectation = firstSyncExpectation
        context.cloudSyncService.runLinkedSyncErrors = [
            LocalStoreError.validation("Transient linked sync failure.")
        ]

        firstStore.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [firstSyncExpectation], timeout: 1.0)
        await waitForAIChatToolRunPostSyncToSettle(store: firstStore)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)

        let secondStore = context.makeStore()
        let secondSyncExpectation = XCTestExpectation(description: "Second linked sync attempt succeeded")
        context.cloudSyncService.syncExpectation = secondSyncExpectation

        secondStore.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [secondSyncExpectation], timeout: 1.0)
        await secondStore.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 2)
        XCTAssertFalse(secondStore.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedTerminalResponseTriggersOneLinkedSync() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after accepted terminal response")
        context.cloudSyncService.syncExpectation = syncExpectation
        store.activeConversationId = "conversation-1"

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: [
                            makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            makeAssistantToolCallMessage(toolCallStatus: .completed)
                        ],
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

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedTerminalResponseWithHistoricalToolCallDoesNotTriggerSync() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.activeConversationId = "conversation-1"

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: [
                            makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:58:00Z"
                            ),
                            makeAssistantToolCallMessage(toolCallStatus: .completed),
                            makeUserTextMessage(
                                id: "message-2",
                                text: "Summarize the result.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            makeAssistantTextMessage(
                                id: "message-3",
                                itemId: "item-3",
                                text: "Here is a plain-text summary.",
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
                    activeRun: nil,
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )

        await waitForBackgroundAIChatTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testBootstrapTerminalSnapshotDoesNotTriggerSyncFromHistoricalToolCall() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [
                    makeUserTextMessage(
                        id: "message-0",
                        text: "Run a query.",
                        timestamp: "2026-04-08T09:58:00Z"
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
                        timestamp: "2026-04-08T09:59:00Z",
                        isError: false,
                        isStopped: true,
                        cursor: "cursor-1",
                        itemId: "item-1"
                    ),
                    makeUserTextMessage(
                        id: "message-2",
                        text: "Summarize the result.",
                        timestamp: "2026-04-08T10:00:00Z"
                    ),
                    AIChatMessage(
                        id: "message-3",
                        role: .assistant,
                        content: [.text("Here is a plain-text summary.")],
                        timestamp: "2026-04-08T10:01:00Z",
                        isError: false,
                        isStopped: true,
                        cursor: "cursor-3",
                        itemId: "item-3"
                    )
                ],
                activeRun: nil
            )
        )

        await waitForBackgroundAIChatTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedActiveRunResponseWithTrailingToolCallArmsPendingSyncWithoutImmediateSync() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.activeConversationId = "conversation-1"

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: [
                            makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            makeAssistantToolCallMessage(toolCallStatus: .started)
                        ],
                        updatedAt: 1,
                        mainContentInvalidationVersion: 1,
                        hasOlder: false,
                        oldestCursor: nil
                    ),
                    composerSuggestions: [],
                    chatConfig: aiChatDefaultServerConfig,
                    activeRun: makeActiveRun(),
                    deduplicated: nil
                )
            ),
            conversationId: "conversation-1"
        )

        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertTrue(store.pendingToolRunPostSync)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedTerminalGuestResponseTriggersOneSyncAndClearsPersistedFlag() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Guest sync started once after accepted terminal response")
        context.cloudSyncService.syncExpectation = syncExpectation
        store.activeConversationId = "conversation-1"

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: [
                            makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            makeAssistantToolCallMessage(toolCallStatus: .completed)
                        ],
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

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedTerminalGuestResponseKeepsPendingFlagAfterSyncFailure() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Guest sync started once and failed")
        context.cloudSyncService.syncExpectation = syncExpectation
        context.cloudSyncService.runLinkedSyncErrors = [
            LocalStoreError.validation("Transient guest sync failure.")
        ]
        store.activeConversationId = "conversation-1"

        await store.handleRuntimeEvent(
            .accepted(
                AIChatStartRunResponse(
                    accepted: true,
                    sessionId: "session-1",
                    conversationScopeId: "session-1",
                    conversation: AIChatConversation(
                        messages: [
                            makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            makeAssistantToolCallMessage(toolCallStatus: .completed)
                        ],
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

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertTrue(store.pendingToolRunPostSync)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testReopeningPlainTextLatestConversationDoesNotTriggerAnotherSync() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [
                    makeUserTextMessage(
                        id: "message-0",
                        text: "Run a query.",
                        timestamp: "2026-04-08T09:58:00Z"
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
                        timestamp: "2026-04-08T09:59:00Z",
                        isError: false,
                        isStopped: true,
                        cursor: "cursor-1",
                        itemId: "item-1"
                    ),
                    makeUserTextMessage(
                        id: "message-2",
                        text: "Summarize the result.",
                        timestamp: "2026-04-08T10:00:00Z"
                    ),
                    AIChatMessage(
                        id: "message-3",
                        role: .assistant,
                        content: [.text("Here is a plain-text summary.")],
                        timestamp: "2026-04-08T10:01:00Z",
                        isError: false,
                        isStopped: true,
                        cursor: "cursor-3",
                        itemId: "item-3"
                    )
                ],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: false
            )
        )

        let store = context.makeStore()

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [
                    makeUserTextMessage(
                        id: "message-0",
                        text: "Run a query.",
                        timestamp: "2026-04-08T09:58:00Z"
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
                        timestamp: "2026-04-08T09:59:00Z",
                        isError: false,
                        isStopped: true,
                        cursor: "cursor-1",
                        itemId: "item-1"
                    ),
                    makeUserTextMessage(
                        id: "message-2",
                        text: "Summarize the result.",
                        timestamp: "2026-04-08T10:00:00Z"
                    ),
                    AIChatMessage(
                        id: "message-3",
                        role: .assistant,
                        content: [.text("Here is a plain-text summary.")],
                        timestamp: "2026-04-08T10:01:00Z",
                        isError: false,
                        isStopped: true,
                        cursor: "cursor-3",
                        itemId: "item-3"
                    )
                ],
                activeRun: nil
            )
        )

        await waitForBackgroundAIChatTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testDuplicateBootstrapTriggersDoNotStartMultipleLinkedSyncs() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Single linked sync started")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestAsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await waitForAIChatBootstrapToSettle(store: store)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)

        await gate.release()
        await waitForAIChatToolRunPostSyncToSettle(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testTerminalPostSyncWorkspaceSwitchDoesNotClearNewWorkspacePendingFlag() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let originalWorkspaceId = context.linkedHistoryWorkspaceId(workspaceId: "workspace-1")
        await context.historyStore.saveState(
            workspaceId: originalWorkspaceId,
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )
        let replacementWorkspaceId = context.linkedHistoryWorkspaceId(workspaceId: "workspace-2")
        await context.historyStore.saveState(
            workspaceId: replacementWorkspaceId,
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-2")],
                chatSessionId: "session-2",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started before workspace switch")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestAsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)

        try context.configureLinkedCloudSession(workspaceId: "workspace-2")
        store.activateAccessContext(
            force: true,
            nextAccessContext: store.currentAccessContext()
        )

        XCTAssertEqual(store.chatSessionId, "session-2")
        XCTAssertTrue(store.pendingToolRunPostSync)

        await gate.release()
        await waitForAIChatToolRunPostSyncWorkspaceSwitchToSettle(
            store: store,
            historyStore: context.historyStore,
            originalWorkspaceId: originalWorkspaceId,
            replacementWorkspaceId: replacementWorkspaceId
        )

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(store.chatSessionId, "session-2")
        XCTAssertTrue(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState(workspaceId: originalWorkspaceId).pendingToolRunPostSync)
        XCTAssertTrue(context.historyStore.loadState(workspaceId: replacementWorkspaceId).pendingToolRunPostSync)
    }

    func testTerminalPostSyncLocalSessionResetKeepsNewSessionState() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started before local session reset")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestAsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            makeConversationEnvelope(
                messages: [makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)

        let freshSessionId = makeAIChatSessionId()
        store.resetConversationForNewSession(
            sessionId: freshSessionId,
            inputText: "",
            pendingAttachments: []
        )
        await store.waitForPendingStatePersistence()

        await gate.release()
        await waitForAIChatToolRunPostSyncToSettle(store: store)

        let persistedState = context.historyStore.loadState()
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(store.chatSessionId, freshSessionId)
        XCTAssertEqual(persistedState.chatSessionId, freshSessionId)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(persistedState.pendingToolRunPostSync)
    }

    func testStartLinkedBootstrapCreatesExplicitSessionBeforeBootstrapForLinkedSession() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during linked bootstrap load.")
            }
            return makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await waitForAIChatBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.events, [
            "createNewSession:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
    }

    func testStartLinkedBootstrapCreatesExplicitSessionBeforeBootstrapForGuestSession() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.loadBootstrapHandler = { sessionId in
            guard let sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id during guest bootstrap load.")
            }
            return makeConversationEnvelope(
                sessionId: sessionId,
                messages: [],
                activeRun: nil
            )
        }

        store.startLinkedBootstrap(forceReloadState: false, resumeAttemptDiagnostics: nil)
        await waitForAIChatBootstrapToSettle(store: store)

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.events, [
            "createNewSession:\(explicitSessionId)",
            "loadBootstrap:\(explicitSessionId)"
        ])
        XCTAssertEqual(context.chatService.loadBootstrapSessionIds, [explicitSessionId])
        XCTAssertEqual(store.chatSessionId, explicitSessionId)
    }

    func testFirstSendUsesExplicitSessionWithoutSnapshotRecovery() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.chatSessionId = ""
        store.conversationScopeId = ""
        store.inputText = "Help me review this."
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before the first send.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return makeNewSessionResponse(sessionId: sessionId)
        }
        context.chatService.startRunHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id in the first send request.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return makeAcceptedStartRunResponse(sessionId: sessionId, userText: "Help me review this.")
        }

        store.sendMessage()
        await waitForAIChatSendToSettle(store: store)
        await store.waitForPendingStatePersistence()

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        XCTAssertEqual(context.chatService.startRunRequests.map(\.sessionId), [explicitSessionId])
        XCTAssertTrue(context.chatService.loadSnapshotSessionIds.isEmpty)
        XCTAssertNil(store.activeSendTask)
        XCTAssertNil(store.activeAlert)
    }

    func testFirstDictationUsesExplicitSessionId() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let voiceRecorder = AIChatStoreTestVoiceRecorder()
        let transcriber = AIChatStoreTestAudioTranscriber()
        let store = context.makeStore(
            voiceRecorder: voiceRecorder,
            audioTranscriber: transcriber
        )
        store.acceptExternalProviderConsent()
        store.chatSessionId = ""
        store.conversationScopeId = ""
        store.dictationState = .recording
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id before the first dictation.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            return makeNewSessionResponse(sessionId: sessionId)
        }

        store.finishDictation()
        await waitForAIChatDictationToSettle(store: store)
        await store.waitForPendingStatePersistence()

        let explicitSessionId = try XCTUnwrap(context.chatService.createNewSessionSessionIds.first ?? nil)
        let transcribedSessionIds = await transcriber.transcribedSessionIds()
        XCTAssertEqual(transcribedSessionIds, [explicitSessionId])
        XCTAssertNil(store.activeAlert)
    }

    func testRemoteSessionProvisioningRetryReusesSameExplicitSessionId() async throws {
        let context = AIChatStoreTestContext.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        var createAttempts = 0
        context.chatService.createNewSessionHandler = { request in
            guard let sessionId = request.sessionId, sessionId.isEmpty == false else {
                throw LocalStoreError.validation("Expected an explicit AI chat session id for retry coverage.")
            }
            XCTAssertEqual(request.uiLocale, currentAIChatUILocaleIdentifier())
            createAttempts += 1
            if createAttempts == 1 {
                throw LocalStoreError.validation("Transient AI chat provisioning failure.")
            }
            return makeNewSessionResponse(sessionId: sessionId)
        }

        store.startFreshLocalSession(
            inputText: "",
            pendingAttachments: []
        )
        await waitForAIChatNewSessionToSettle(store: store)

        let explicitSessionId = store.chatSessionId
        XCTAssertFalse(explicitSessionId.isEmpty)
        XCTAssertTrue(store.requiresRemoteSessionProvisioning)

        let retriedSessionId = try await store.ensureRemoteSessionIfNeeded()

        XCTAssertEqual(retriedSessionId, explicitSessionId)
        XCTAssertEqual(context.chatService.createNewSessionSessionIds, [
            explicitSessionId,
            explicitSessionId
        ])
        XCTAssertFalse(store.requiresRemoteSessionProvisioning)
    }

    func testHistoryStoreLoadsLegacyStateWithoutPendingToolRunPostSyncField() {
        let suiteName = "ai-chat-legacy-state-\(UUID().uuidString)"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let store = AIChatHistoryStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let legacyPayload = """
        {"messages":[],"chatSessionId":"session-1","lastKnownChatConfig":null}
        """
        userDefaults.set(2, forKey: "ai-chat-history-cleanup-version")
        userDefaults.set(Data(legacyPayload.utf8), forKey: aiChatHistoryStorageKey)

        let loadedState = store.loadState()

        XCTAssertEqual(loadedState.chatSessionId, "session-1")
        XCTAssertFalse(loadedState.pendingToolRunPostSync)
    }
}

private struct AIChatStoreTestContext {
    let suiteName: String
    let userDefaults: UserDefaults
    let databaseURL: URL
    let database: LocalDatabase
    let historyStore: AIChatHistoryStore
    let flashcardsStore: FlashcardsStore
    let chatService: AIChatStoreTestChatService
    let cloudSyncService: AIChatStoreTestCloudSyncService

    @MainActor
    static func make() -> AIChatStoreTestContext {
        let suiteName = "ai-chat-run-tool-call-tracking-\(UUID().uuidString)"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ai-chat-run-tool-call-tracking-\(UUID().uuidString.lowercased())")
            .appendingPathExtension("sqlite")
        let database = try! LocalDatabase(databaseURL: databaseURL)
        let historyStore = AIChatHistoryStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let cloudSyncService = AIChatStoreTestCloudSyncService()
        let flashcardsStore = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: CloudCredentialStore(service: "tests-\(suiteName)-cloud-auth"),
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: GuestCloudCredentialStore(
                service: "tests-\(suiteName)-guest-auth",
                bundle: .main,
                userDefaults: userDefaults
            ),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )

        return AIChatStoreTestContext(
            suiteName: suiteName,
            userDefaults: userDefaults,
            databaseURL: databaseURL,
            database: database,
            historyStore: historyStore,
            flashcardsStore: flashcardsStore,
            chatService: AIChatStoreTestChatService(),
            cloudSyncService: cloudSyncService
        )
    }

    @MainActor
    func makeStore() -> AIChatStore {
        self.makeStore(
            voiceRecorder: AIChatDisabledVoiceRecorder(),
            audioTranscriber: AIChatDisabledAudioTranscriber()
        )
    }

    @MainActor
    func makeStore(
        voiceRecorder: any AIChatVoiceRecording,
        audioTranscriber: any AIChatAudioTranscribing
    ) -> AIChatStore {
        AIChatStore(
            flashcardsStore: self.flashcardsStore,
            historyStore: self.historyStore,
            chatService: self.chatService,
            contextLoader: AIChatStoreTestContextLoader(),
            voiceRecorder: voiceRecorder,
            audioTranscriber: audioTranscriber
        )
    }

    @MainActor
    func configureLinkedCloudSession() throws {
        try self.configureLinkedCloudSession(workspaceId: "workspace-1")
    }

    @MainActor
    func configureLinkedCloudSession(workspaceId: String) throws {
        let linkedSession = CloudLinkedSession(
            userId: "user-1",
            workspaceId: workspaceId,
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.example.com",
            authorization: .bearer("token-1")
        )
        self.flashcardsStore.workspace = Workspace(
            workspaceId: workspaceId,
            name: "Workspace",
            createdAt: "2026-04-08T10:00:00Z"
        )
        self.flashcardsStore.cloudSettings = CloudSettings(
            installationId: "installation-1",
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: workspaceId,
            activeWorkspaceId: workspaceId,
            linkedEmail: "user@example.com",
            onboardingCompleted: true,
            updatedAt: "2026-04-08T10:00:00Z"
        )
        try self.flashcardsStore.cloudRuntime.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token-1",
                idToken: "token-1",
                idTokenExpiresAt: "2099-01-01T00:00:00Z"
            )
        )
        self.flashcardsStore.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        self.historyStore.activateWorkspace(
            workspaceId: makeAIChatHistoryScopedWorkspaceId(
                workspaceId: self.flashcardsStore.workspace?.workspaceId,
                cloudSettings: self.flashcardsStore.cloudSettings
            )
        )
    }

    func linkedHistoryWorkspaceId(workspaceId: String) -> String {
        makeAIChatHistoryScopedWorkspaceId(
            workspaceId: workspaceId,
            cloudSettings: CloudSettings(
                installationId: "installation-1",
                cloudState: .linked,
                linkedUserId: "user-1",
                linkedWorkspaceId: workspaceId,
                activeWorkspaceId: workspaceId,
                linkedEmail: "user@example.com",
                onboardingCompleted: true,
                updatedAt: "2026-04-08T10:00:00Z"
            )
        )!
    }

    @MainActor
    func configureGuestCloudSession() throws {
        let configuration = try self.flashcardsStore.currentCloudServiceConfiguration()
        let guestSession = StoredGuestCloudSession(
            guestToken: "guest-token-1",
            userId: "guest-user-1",
            workspaceId: "workspace-1",
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl
        )
        let linkedSession = CloudLinkedSession(
            userId: guestSession.userId,
            workspaceId: guestSession.workspaceId,
            email: nil,
            configurationMode: guestSession.configurationMode,
            apiBaseUrl: guestSession.apiBaseUrl,
            authorization: .guest(guestSession.guestToken)
        )
        self.flashcardsStore.workspace = Workspace(
            workspaceId: "workspace-1",
            name: "Workspace",
            createdAt: "2026-04-08T10:00:00Z"
        )
        self.flashcardsStore.cloudSettings = CloudSettings(
            installationId: "installation-1",
            cloudState: .guest,
            linkedUserId: guestSession.userId,
            linkedWorkspaceId: guestSession.workspaceId,
            activeWorkspaceId: guestSession.workspaceId,
            linkedEmail: nil,
            onboardingCompleted: true,
            updatedAt: "2026-04-08T10:00:00Z"
        )
        try self.flashcardsStore.dependencies.guestCredentialStore.saveGuestSession(session: guestSession)
        self.flashcardsStore.cloudRuntime.setActiveCloudSession(linkedSession: linkedSession)
        self.historyStore.activateWorkspace(
            workspaceId: makeAIChatHistoryScopedWorkspaceId(
                workspaceId: self.flashcardsStore.workspace?.workspaceId,
                cloudSettings: self.flashcardsStore.cloudSettings
            )
        )
    }

    func tearDown() {
        self.userDefaults.removePersistentDomain(forName: self.suiteName)
    }
}

private struct AIChatStoreTestContextLoader: AIChatContextLoading {
    func loadContext() async throws -> AIChatContext {
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }
}

private final class AIChatStoreTestChatService: AIChatSessionServicing, @unchecked Sendable {
    var events: [String]
    var loadSnapshotSessionIds: [String?]
    var loadBootstrapSessionIds: [String?]
    var startRunRequests: [AIChatStartRunRequestBody]
    var createNewSessionRequests: [AIChatNewSessionRequestBody]
    var loadBootstrapHandler: ((String?) throws -> AIChatBootstrapResponse)?
    var startRunHandler: ((AIChatStartRunRequestBody) throws -> AIChatStartRunResponse)?
    var createNewSessionHandler: ((AIChatNewSessionRequestBody) throws -> AIChatNewSessionResponse)?

    var createNewSessionSessionIds: [String?] {
        self.createNewSessionRequests.map(\.sessionId)
    }

    init() {
        self.events = []
        self.loadSnapshotSessionIds = []
        self.loadBootstrapSessionIds = []
        self.startRunRequests = []
        self.createNewSessionRequests = []
        self.loadBootstrapHandler = nil
        self.startRunHandler = nil
        self.createNewSessionHandler = nil
    }

    func loadSnapshot(
        session: CloudLinkedSession,
        sessionId: String?
    ) async throws -> AIChatSessionSnapshot {
        _ = session
        self.events.append("loadSnapshot:\(sessionId ?? "nil")")
        self.loadSnapshotSessionIds.append(sessionId)
        throw LocalStoreError.validation("Unexpected AI chat snapshot request in tests.")
    }

    func loadBootstrap(
        session: CloudLinkedSession,
        sessionId: String?,
        limit: Int,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) async throws -> AIChatBootstrapResponse {
        _ = session
        _ = limit
        _ = resumeAttemptDiagnostics
        self.events.append("loadBootstrap:\(sessionId ?? "nil")")
        self.loadBootstrapSessionIds.append(sessionId)
        guard let loadBootstrapHandler else {
            throw LocalStoreError.validation("Unexpected AI chat bootstrap request in tests.")
        }
        return try loadBootstrapHandler(sessionId)
    }

    func loadOlderMessages(
        session: CloudLinkedSession,
        sessionId: String,
        beforeCursor: String,
        limit: Int
    ) async throws -> AIChatOlderMessagesResponse {
        _ = session
        _ = sessionId
        _ = beforeCursor
        _ = limit
        throw LocalStoreError.validation("Unexpected AI chat older-messages request in tests.")
    }

    func startRun(
        session: CloudLinkedSession,
        request: AIChatStartRunRequestBody
    ) async throws -> AIChatStartRunResponse {
        _ = session
        self.events.append("startRun:\(request.sessionId ?? "nil")")
        self.startRunRequests.append(request)
        guard let startRunHandler else {
            throw LocalStoreError.validation("Unexpected AI chat start-run request in tests.")
        }
        return try startRunHandler(request)
    }

    func createNewSession(
        session: CloudLinkedSession,
        request: AIChatNewSessionRequestBody
    ) async throws -> AIChatNewSessionResponse {
        _ = session
        self.events.append("createNewSession:\(request.sessionId ?? "nil")")
        self.createNewSessionRequests.append(request)
        guard let createNewSessionHandler else {
            throw LocalStoreError.validation("Unexpected AI chat new-session request in tests.")
        }
        return try createNewSessionHandler(request)
    }

    func stopRun(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> AIChatStopRunResponse {
        _ = session
        return AIChatStopRunResponse(
            sessionId: sessionId,
            stopped: false,
            stillRunning: false
        )
    }
}

@MainActor
private final class AIChatStoreTestCloudSyncService: CloudSyncServing {
    var runLinkedSyncCallCount: Int
    var syncExpectation: XCTestExpectation?
    var runLinkedSyncErrors: [Error]
    var runLinkedSyncGate: AIChatStoreTestAsyncGate?

    init() {
        self.runLinkedSyncCallCount = 0
        self.syncExpectation = nil
        self.runLinkedSyncErrors = []
        self.runLinkedSyncGate = nil
    }

    func fetchCloudAccount(apiBaseUrl: String, bearerToken: String) async throws -> CloudAccountSnapshot {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func createWorkspace(apiBaseUrl: String, bearerToken: String, name: String) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = name
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = name
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceDeletePreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceResetProgressPreview {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceDeleteResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ) async throws -> CloudWorkspaceResetProgressResult {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        _ = confirmationText
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ) async throws -> CloudWorkspaceSummary {
        _ = apiBaseUrl
        _ = bearerToken
        _ = workspaceId
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func listAgentApiKeys(
        apiBaseUrl: String,
        bearerToken: String
    ) async throws -> ([AgentApiKeyConnection], String) {
        _ = apiBaseUrl
        _ = bearerToken
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func revokeAgentApiKey(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ) async throws -> (AgentApiKeyConnection, String) {
        _ = apiBaseUrl
        _ = bearerToken
        _ = connectionId
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func isWorkspaceEmptyForBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        installationId: String
    ) async throws -> Bool {
        _ = apiBaseUrl
        _ = authorizationHeader
        _ = workspaceId
        _ = installationId
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) async throws {
        _ = apiBaseUrl
        _ = bearerToken
        _ = confirmationText
        fatalError("Not used in AIChatStoreRunToolCallTrackingTests.")
    }

    func runLinkedSync(linkedSession: CloudLinkedSession) async throws -> CloudSyncResult {
        _ = linkedSession
        self.runLinkedSyncCallCount += 1
        self.syncExpectation?.fulfill()
        if let runLinkedSyncGate = self.runLinkedSyncGate {
            await runLinkedSyncGate.wait()
            self.runLinkedSyncGate = nil
        }
        if self.runLinkedSyncErrors.isEmpty == false {
            let error = self.runLinkedSyncErrors.removeFirst()
            throw error
        }
        return CloudSyncResult(
            appliedPullChangeCount: 0,
            changedEntityTypes: [],
            acknowledgedOperationCount: 0,
            cleanedUpOperationCount: 0
        )
    }
}

private func makeConversationEnvelope(
    messages: [AIChatMessage],
    activeRun: AIChatActiveRun?
) -> AIChatConversationEnvelope {
    makeConversationEnvelope(
        sessionId: "session-1",
        messages: messages,
        activeRun: activeRun
    )
}

private func makeConversationEnvelope(
    sessionId: String,
    messages: [AIChatMessage],
    activeRun: AIChatActiveRun?
) -> AIChatConversationEnvelope {
    AIChatConversationEnvelope(
        sessionId: sessionId,
        conversationScopeId: sessionId,
        conversation: AIChatConversation(
            messages: messages,
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

private func makeActiveRun() -> AIChatActiveRun {
    AIChatActiveRun(
        runId: "run-1",
        status: "running",
        live: AIChatActiveRunLive(
            cursor: "cursor-1",
            stream: AIChatLiveStreamEnvelope(
                url: "https://example.com/live",
                authorization: "Bearer token",
                expiresAt: 1
            )
        ),
        lastHeartbeatAt: nil
    )
}

private func makeAssistantToolCallMessage(toolCallStatus: AIChatToolCallStatus) -> AIChatMessage {
    AIChatMessage(
        id: "message-1",
        role: .assistant,
        content: [
            .toolCall(
                AIChatToolCall(
                    id: "tool-1",
                    name: "sql",
                    status: toolCallStatus,
                    input: "{\"query\":\"select 1\"}",
                    output: nil
                )
            )
        ],
        timestamp: "2026-04-08T10:00:00Z",
        isError: false,
        isStopped: false,
        cursor: "cursor-1",
        itemId: "item-1"
    )
}

private func makeAssistantTextMessage(itemId: String) -> AIChatMessage {
    AIChatMessage(
        id: "message-1",
        role: .assistant,
        content: [.text("Working on it.")],
        timestamp: "2026-04-08T10:00:00Z",
        isError: false,
        isStopped: false,
        cursor: "cursor-1",
        itemId: itemId
    )
}

private func makeUserTextMessage(id: String, text: String, timestamp: String) -> AIChatMessage {
    AIChatMessage(
        id: id,
        role: .user,
        content: [.text(text)],
        timestamp: timestamp,
        isError: false,
        isStopped: false,
        cursor: nil,
        itemId: nil
    )
}

private func makeAssistantTextMessage(
    id: String,
    itemId: String,
    text: String,
    timestamp: String
) -> AIChatMessage {
    AIChatMessage(
        id: id,
        role: .assistant,
        content: [.text(text)],
        timestamp: timestamp,
        isError: false,
        isStopped: false,
        cursor: "cursor-\(id)",
        itemId: itemId
    )
}

private let aiChatBackgroundTaskTimeout: Duration = .seconds(2)
private let aiChatTaskTimeout: Duration = .seconds(3)
private let aiChatToolRunPostSyncTaskTimeout: Duration = .seconds(5)
private let aiChatWorkspaceSwitchToolRunPostSyncTimeout: Duration = .seconds(8)
private let aiChatTaskPollInterval: Duration = .milliseconds(10)

@MainActor
private func waitForBackgroundAIChatTasks(store: AIChatStore) async {
    _ = await waitForAIChatCondition(
        description: "AI chat background tasks to become idle",
        timeout: aiChatBackgroundTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        condition: {
            store.activeToolRunPostSyncTask == nil
                && store.activeBootstrapTask == nil
                && store.activeSendTask == nil
                && store.activeDictationTask == nil
                && store.activeNewSessionTask == nil
                && store.activePersistTask == nil
                && store.pendingPersistState == nil
        }
    )
}

@MainActor
private func waitForAIChatCondition(
    description: String,
    timeout: Duration,
    pollInterval: Duration,
    condition: @escaping @MainActor () -> Bool
) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)

    while true {
        if condition() {
            return true
        }

        if clock.now >= deadline {
            XCTFail("Timed out waiting for \(description).")
            return false
        }

        try? await Task.sleep(for: pollInterval)
    }
}

@MainActor
private func waitForAIChatTaskToClear(
    description: String,
    timeout: Duration,
    pollInterval: Duration,
    taskProvider: @escaping @MainActor () -> Task<Void, Never>?
) async -> Bool {
    return await waitForAIChatCondition(
        description: "\(description) became nil",
        timeout: timeout,
        pollInterval: pollInterval,
        condition: {
            taskProvider() == nil
        }
    )
}

@MainActor
private func waitForAIChatPendingStatePersistenceToDrain(store: AIChatStore) async {
    _ = await waitForAIChatCondition(
        description: "pending state persistence drained",
        timeout: aiChatTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        condition: {
            store.activePersistTask == nil && store.pendingPersistState == nil
        }
    )
}

@MainActor
private func waitForAIChatToolRunPostSyncToSettle(store: AIChatStore) async {
    let didSettle = await waitForAIChatTaskToClear(
        description: "activeToolRunPostSyncTask",
        timeout: aiChatToolRunPostSyncTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        taskProvider: {
            store.activeToolRunPostSyncTask
        }
    )
    if didSettle == false {
        return
    }
    await waitForAIChatPendingStatePersistenceToDrain(store: store)
}

@MainActor
private func waitForAIChatToolRunPostSyncWorkspaceSwitchToSettle(
    store: AIChatStore,
    historyStore: any AIChatHistoryStoring,
    originalWorkspaceId: String,
    replacementWorkspaceId: String
) async {
    _ = await waitForAIChatCondition(
        description: "workspace-switch post-sync settled",
        timeout: aiChatWorkspaceSwitchToolRunPostSyncTimeout,
        pollInterval: aiChatTaskPollInterval,
        condition: {
            let originalState = historyStore.loadState(workspaceId: originalWorkspaceId)
            let replacementState = historyStore.loadState(workspaceId: replacementWorkspaceId)
            return store.activeToolRunPostSyncTask == nil
                && store.activePersistTask == nil
                && store.pendingPersistState == nil
                && store.chatSessionId == replacementState.chatSessionId
                && store.pendingToolRunPostSync
                && originalState.pendingToolRunPostSync == false
                && replacementState.pendingToolRunPostSync
        }
    )
}

@MainActor
private func waitForAIChatBootstrapToSettle(store: AIChatStore) async {
    _ = await waitForAIChatTaskToClear(
        description: "activeBootstrapTask",
        timeout: aiChatTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        taskProvider: {
            store.activeBootstrapTask
        }
    )
}

@MainActor
private func waitForAIChatSendToSettle(store: AIChatStore) async {
    _ = await waitForAIChatTaskToClear(
        description: "activeSendTask",
        timeout: aiChatTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        taskProvider: {
            store.activeSendTask
        }
    )
}

@MainActor
private func waitForAIChatDictationToSettle(store: AIChatStore) async {
    _ = await waitForAIChatTaskToClear(
        description: "activeDictationTask",
        timeout: aiChatTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        taskProvider: {
            store.activeDictationTask
        }
    )
}

@MainActor
private func waitForAIChatNewSessionToSettle(store: AIChatStore) async {
    _ = await waitForAIChatTaskToClear(
        description: "activeNewSessionTask",
        timeout: aiChatTaskTimeout,
        pollInterval: aiChatTaskPollInterval,
        taskProvider: {
            store.activeNewSessionTask
        }
    )
}

private func makeNewSessionResponse(sessionId: String) -> AIChatNewSessionResponse {
    let chatConfigData = try! JSONEncoder().encode(aiChatDefaultServerConfig)
    let chatConfigObject = try! JSONSerialization.jsonObject(with: chatConfigData)
    let data = try! JSONSerialization.data(
        withJSONObject: [
            "ok": true,
            "sessionId": sessionId,
            "composerSuggestions": [],
            "chatConfig": chatConfigObject
        ]
    )
    return try! JSONDecoder().decode(AIChatNewSessionResponse.self, from: data)
}

private func makeAcceptedStartRunResponse(sessionId: String, userText: String) -> AIChatStartRunResponse {
    AIChatStartRunResponse(
        accepted: true,
        sessionId: sessionId,
        conversationScopeId: sessionId,
        conversation: AIChatConversation(
            messages: [
                makeUserTextMessage(
                    id: "message-0",
                    text: userText,
                    timestamp: "2026-04-08T10:00:00Z"
                ),
                makeAssistantTextMessage(
                    id: "message-1",
                    itemId: "item-1",
                    text: "Working on it.",
                    timestamp: "2026-04-08T10:00:01Z"
                )
            ],
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
}

@MainActor
private final class AIChatStoreTestVoiceRecorder: AIChatVoiceRecording {
    func startRecording() async throws {
        throw LocalStoreError.validation("Not used in AI chat dictation tests.")
    }

    func stopRecording() async throws -> AIChatRecordedAudio {
        let fileUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased())
            .appendingPathExtension("m4a")
        try Data("audio".utf8).write(to: fileUrl)
        return AIChatRecordedAudio(
            fileUrl: fileUrl,
            fileName: "chat-dictation.m4a",
            mediaType: "audio/mp4"
        )
    }

    func cancelRecording() {
    }
}

actor AIChatStoreTestAudioTranscriber: AIChatAudioTranscribing {
    private var sessionIds: [String?]

    init() {
        self.sessionIds = []
    }

    func transcribe(
        session: CloudLinkedSession,
        sessionId: String?,
        recordedAudio: AIChatRecordedAudio
    ) async throws -> AIChatTranscriptionResult {
        _ = session
        _ = recordedAudio
        self.sessionIds.append(sessionId)
        guard let sessionId, sessionId.isEmpty == false else {
            throw LocalStoreError.validation("Expected an explicit AI chat session id for transcription.")
        }
        return AIChatTranscriptionResult(
            text: "Transcript",
            sessionId: sessionId
        )
    }

    func transcribedSessionIds() -> [String?] {
        self.sessionIds
    }
}

private actor AIChatStoreTestAsyncGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var isReleased: Bool

    init() {
        self.continuation = nil
        self.isReleased = false
    }

    func wait() async {
        if self.isReleased {
            return
        }

        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func release() {
        self.isReleased = true
        self.continuation?.resume()
        self.continuation = nil
    }
}
