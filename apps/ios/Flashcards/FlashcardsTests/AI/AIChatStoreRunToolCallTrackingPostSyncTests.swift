import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreRunToolCallTrackingPostSyncTests: XCTestCase {
    func testBootstrapAfterRelaunchTriggersOneLinkedSyncFromPersistedFlag() async throws {
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
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after bootstrap")
        context.cloudSyncService.syncExpectation = syncExpectation

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
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
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started once after assistant-only terminal tool call snapshot")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestSupport.AsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
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
        await AIChatStoreTestSupport.waitForToolRunPostSyncToSettle(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testBootstrapAssistantOnlyTerminalPlainTextDoesNotArmSyncFromEarlierAssistantItemToolCall() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
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
                    AIChatStoreTestSupport.makeAssistantTextMessage(
                        id: "message-2",
                        itemId: "item-2",
                        text: "Here is a plain-text summary.",
                        timestamp: "2026-04-08T10:00:05Z"
                    )
                ],
                activeRun: nil
            )
        )

        await AIChatStoreTestSupport.waitForBackgroundTasks(store: store)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.runHadToolCalls)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testFailedLinkedSyncLeavesPendingFlagPersisted() async throws {
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
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)
        await store.waitForPendingStatePersistence()

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertTrue(store.pendingToolRunPostSync)
    }

    func testBootstrapAfterFailedLinkedSyncRetriesOnNextLaunchAndClearsPersistedFlag() async throws {
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
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [firstSyncExpectation], timeout: 1.0)
        await AIChatStoreTestSupport.waitForToolRunPostSyncToSettle(store: firstStore)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)

        let secondStore = context.makeStore()
        let secondSyncExpectation = XCTestExpectation(description: "Second linked sync attempt succeeded")
        context.cloudSyncService.syncExpectation = secondSyncExpectation

        secondStore.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
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
        let context = AIChatStoreTestSupport.Context.make()
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
                            AIChatStoreTestSupport.makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .completed)
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
        let context = AIChatStoreTestSupport.Context.make()
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
                            AIChatStoreTestSupport.makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:58:00Z"
                            ),
                            AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .completed),
                            AIChatStoreTestSupport.makeUserTextMessage(
                                id: "message-2",
                                text: "Summarize the result.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            AIChatStoreTestSupport.makeAssistantTextMessage(
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

        await AIChatStoreTestSupport.waitForBackgroundTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testBootstrapTerminalSnapshotDoesNotTriggerSyncFromHistoricalToolCall() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let store = context.makeStore()

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [
                    AIChatStoreTestSupport.makeUserTextMessage(
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
                    AIChatStoreTestSupport.makeUserTextMessage(
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

        await AIChatStoreTestSupport.waitForBackgroundTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedActiveRunResponseWithTrailingToolCallArmsPendingSyncWithoutImmediateSync() async throws {
        let context = AIChatStoreTestSupport.Context.make()
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
                            AIChatStoreTestSupport.makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .started)
                        ],
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

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertTrue(store.pendingToolRunPostSync)
        XCTAssertTrue(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testAcceptedTerminalGuestResponseTriggersOneSyncAndClearsPersistedFlag() async throws {
        let context = AIChatStoreTestSupport.Context.make()
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
                            AIChatStoreTestSupport.makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .completed)
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
        let context = AIChatStoreTestSupport.Context.make()
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
                            AIChatStoreTestSupport.makeUserTextMessage(
                                id: "message-0",
                                text: "Run a query.",
                                timestamp: "2026-04-08T09:59:00Z"
                            ),
                            AIChatStoreTestSupport.makeAssistantToolCallMessage(toolCallStatus: .completed)
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
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        await context.historyStore.saveState(
            state: AIChatPersistedState(
                messages: [
                    AIChatStoreTestSupport.makeUserTextMessage(
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
                    AIChatStoreTestSupport.makeUserTextMessage(
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
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [
                    AIChatStoreTestSupport.makeUserTextMessage(
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
                    AIChatStoreTestSupport.makeUserTextMessage(
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

        await AIChatStoreTestSupport.waitForBackgroundTasks(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 0)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testDuplicateBootstrapTriggersDoNotStartMultipleLinkedSyncs() async throws {
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
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Single linked sync started")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestSupport.AsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await self.fulfillment(of: [syncExpectation], timeout: 1.0)

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
                activeRun: nil
            )
        )

        await AIChatStoreTestSupport.waitForBootstrapToSettle(store: store)
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)

        await gate.release()
        await AIChatStoreTestSupport.waitForToolRunPostSyncToSettle(store: store)

        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(context.historyStore.loadState().pendingToolRunPostSync)
    }

    func testTerminalPostSyncWorkspaceSwitchDoesNotClearNewWorkspacePendingFlag() async throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureLinkedCloudSession()
        let originalWorkspaceId = context.linkedHistoryWorkspaceId(workspaceId: "workspace-1")
        await context.historyStore.saveState(
            workspaceId: originalWorkspaceId,
            state: AIChatPersistedState(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )
        let replacementWorkspaceId = context.linkedHistoryWorkspaceId(workspaceId: "workspace-2")
        await context.historyStore.saveState(
            workspaceId: replacementWorkspaceId,
            state: AIChatPersistedState(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-2")],
                chatSessionId: "session-2",
                lastKnownChatConfig: aiChatDefaultServerConfig,
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started before workspace switch")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestSupport.AsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
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
        await AIChatStoreTestSupport.waitForToolRunPostSyncWorkspaceSwitchToSettle(
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
                pendingToolRunPostSync: true
            )
        )

        let store = context.makeStore()
        let syncExpectation = XCTestExpectation(description: "Linked sync started before local session reset")
        context.cloudSyncService.syncExpectation = syncExpectation
        let gate = AIChatStoreTestSupport.AsyncGate()
        context.cloudSyncService.runLinkedSyncGate = gate

        store.applyBootstrap(
            AIChatStoreTestSupport.makeConversationEnvelope(
                messages: [AIChatStoreTestSupport.makeAssistantTextMessage(itemId: "item-1")],
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
        await AIChatStoreTestSupport.waitForToolRunPostSyncToSettle(store: store)

        let persistedState = context.historyStore.loadState()
        XCTAssertEqual(context.cloudSyncService.runLinkedSyncCallCount, 1)
        XCTAssertEqual(store.chatSessionId, freshSessionId)
        XCTAssertEqual(persistedState.chatSessionId, freshSessionId)
        XCTAssertFalse(store.pendingToolRunPostSync)
        XCTAssertFalse(persistedState.pendingToolRunPostSync)
    }
}
