import Foundation
import XCTest
@testable import Flashcards

final class AIChatStoreFlowTests: AIChatTestCaseBase {
    @MainActor
    func testAIChatStoreBlocksSendWhenCloudIsNotLinked() throws {
        let flashcardsStore = try self.makeStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        XCTAssertEqual(chatStore.messages.count, 0)
        XCTAssertEqual(chatStore.errorMessage, "AI chat requires cloud sign-in.")
    }

    @MainActor
    func testAIChatStoreShowsStreamFailureOnlyInsideAssistantMessage() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: ThrowingChatService(error: StubLocalizedError(message: "Chat failed")),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[0].role, .user)
        XCTAssertEqual(chatStore.messages[0].text, "hello")
        XCTAssertEqual(chatStore.messages[1].role, .assistant)
        XCTAssertEqual(chatStore.messages[1].text, "Chat failed")
        XCTAssertEqual(chatStore.messages[1].isError, true)
    }

    @MainActor
    func testAIChatStoreClearsRepairStatusAfterSuccessfulTurn() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: RepairingChatService(terminalError: nil),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertNil(chatStore.repairStatus)
        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
    }

    @MainActor
    func testAIChatStoreClearsRepairStatusAfterTerminalFailure() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: RepairingChatService(terminalError: StubLocalizedError(message: "Still invalid")),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertNil(chatStore.repairStatus)
        XCTAssertEqual(chatStore.messages[1].isError, true)
        XCTAssertEqual(chatStore.messages[1].text, "Checking\n\nStill invalid")
    }

    @MainActor
    func testAIChatStoreDoesNotPersistHistoryOnEveryStreamToken() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let historyStore = InMemoryHistoryStore(
            savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
        )
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: BurstChatService(deltas: Array(repeating: "A", count: 20)),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.messages[1].text, String(repeating: "A", count: 20))
        XCTAssertLessThan(historyStore.saveCallCount, 20)
    }

    @MainActor
    func testAIChatStoreWarmUpPreparesSessionWithoutMutatingMessages() async throws {
        let requestRecorder = RequestRecorder()
        AIChatMockUrlProtocol.requestHandler = { request in
            requestRecorder.append(request)

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = """
            {"ok":true,"idToken":"refreshed-token","expiresIn":3600}
            """.data(using: .utf8)!
            return (response, body)
        }

        let flashcardsStore = try self.makeLinkedStore(
            cloudAuthService: CloudAuthService(session: self.makeSession(), cookieStorage: HTTPCookieStorage()),
            idTokenExpiresAt: isoTimestamp(date: Date().addingTimeInterval(-300))
        )
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()

        try await Task.sleep(nanoseconds: 50_000_000)

        let requests = requestRecorder.snapshot()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.url?.path, "/api/refresh-token")
        XCTAssertEqual(chatStore.messages, [])
        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertFalse(chatStore.isStreaming)
    }

    @MainActor
    func testFlashcardsStoreWarmUpReusesInFlightPreparation() async throws {
        let requestRecorder = RequestRecorder()
        AIChatMockUrlProtocol.requestHandler = { request in
            requestRecorder.append(request)
            Thread.sleep(forTimeInterval: 0.05)

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = """
            {"ok":true,"idToken":"refreshed-token","expiresIn":3600}
            """.data(using: .utf8)!
            return (response, body)
        }

        let flashcardsStore = try self.makeLinkedStore(
            cloudAuthService: CloudAuthService(session: self.makeSession(), cookieStorage: HTTPCookieStorage()),
            idTokenExpiresAt: isoTimestamp(date: Date().addingTimeInterval(-300))
        )

        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await flashcardsStore.warmUpAuthenticatedCloudSessionForAI()
            }
            group.addTask {
                await flashcardsStore.warmUpAuthenticatedCloudSessionForAI()
            }
        }

        let requests = requestRecorder.snapshot()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.url?.path, "/api/refresh-token")
    }

    @MainActor
    func testAIChatStoreWarmUpIsNoOpWhenCloudIsNotLinked() async throws {
        let flashcardsStore = try self.makeStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()
        try await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(chatStore.messages, [])
        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertFalse(chatStore.isStreaming)
    }

    @MainActor
    func testAIChatStoreWarmUpFailureDoesNotMutateMessagesOrStreamingState() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 500,
                httpVersion: nil,
                headerFields: [
                    "Content-Type": "application/json",
                    "X-Request-Id": "request-warmup-failure"
                ]
            )!
            let body = """
            {"error":"Refresh failed.","requestId":"request-warmup-failure","code":"AUTH_REFRESH_FAILED"}
            """.data(using: .utf8)!
            return (response, body)
        }

        let flashcardsStore = try self.makeLinkedStore(
            cloudAuthService: CloudAuthService(session: self.makeSession(), cookieStorage: HTTPCookieStorage()),
            idTokenExpiresAt: isoTimestamp(date: Date().addingTimeInterval(-300))
        )
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(chatStore.messages, [])
        XCTAssertEqual(chatStore.errorMessage, "")
        XCTAssertFalse(chatStore.isStreaming)
    }

    @MainActor
    func testAIChatStoreSendMessageClearsDraftAndAttachmentsBeforeStreaming() throws {
        let flashcardsStore = try self.makeLinkedStore()
        let historyStore = InMemoryHistoryStore(
            savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
        )
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: historyStore,
            chatService: SuspendingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.appendAttachment(
            AIChatAttachment(
                id: "attachment-1",
                fileName: "note.txt",
                mediaType: "text/plain",
                base64Data: Data("hello".utf8).base64EncodedString()
            )
        )
        chatStore.inputText = "hello"

        chatStore.sendMessage()

        XCTAssertTrue(chatStore.isStreaming)
        XCTAssertEqual(chatStore.inputText, "")
        XCTAssertEqual(chatStore.pendingAttachments, [])
        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[0].role, .user)
        XCTAssertEqual(chatStore.messages[0].content.count, 2)
        XCTAssertEqual(chatStore.messages[1].role, .assistant)
        XCTAssertEqual(chatStore.messages[1].text, aiChatOptimisticAssistantStatusText)

        chatStore.cancelStreaming()
    }

    @MainActor
    func testAIChatStoreRemovesOptimisticStatusWhenToolCallStartsBeforeAnyDelta() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: ToolCallRequestOnlyChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[1].role, .assistant)
        XCTAssertEqual(chatStore.messages[1].text, "")
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
    }

    @MainActor
    func testAIChatStoreCancelStreamingClearsRepairStatusWithoutClearingDraft() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: RepairingSuspendingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForRepairStatus(chatStore: chatStore)
        chatStore.inputText = "next draft"

        chatStore.cancelStreaming()

        XCTAssertFalse(chatStore.isStreaming)
        XCTAssertNil(chatStore.repairStatus)
        XCTAssertEqual(chatStore.inputText, "next draft")
    }

    @MainActor
    func testAIChatStoreKeepsTypedDraftAfterStoppingStreaming() throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: SuspendingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()
        XCTAssertTrue(chatStore.isStreaming)

        chatStore.inputText = "follow up"
        chatStore.cancelStreaming()

        XCTAssertFalse(chatStore.isStreaming)
        XCTAssertEqual(chatStore.inputText, "follow up")
    }

    @MainActor
    func testAIChatStoreKeepsAttachmentsAddedDuringStreamingAfterStopping() throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: SuspendingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()
        XCTAssertTrue(chatStore.isStreaming)

        let pendingAttachment = AIChatAttachment(
            id: "attachment-1",
            fileName: "follow-up.txt",
            mediaType: "text/plain",
            base64Data: Data("next".utf8).base64EncodedString()
        )
        chatStore.appendAttachment(pendingAttachment)
        chatStore.inputText = "follow up"

        chatStore.cancelStreaming()

        XCTAssertFalse(chatStore.isStreaming)
        XCTAssertEqual(chatStore.inputText, "follow up")
        XCTAssertEqual(chatStore.pendingAttachments, [pendingAttachment])
    }

    @MainActor
    func testAIChatStoreAppliesCreateCardPresentationRequestAsDraftOnly() throws {
        let flashcardsStore = try self.makeStore()
        let failingToolExecutor = FailingToolExecutor()
        let persistedMessages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                text: "Existing history",
                toolCalls: [],
                timestamp: "2026-03-09T10:00:00.000Z",
                isError: false
            )
        ]
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: persistedMessages, selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        flashcardsStore.openAICardCreation()
        let request = try XCTUnwrap(flashcardsStore.aiChatPresentationRequest)
        chatStore.applyPresentationRequest(request: request)
        flashcardsStore.clearAIChatPresentationRequest()

        XCTAssertEqual(chatStore.inputText, aiChatCreateCardDraftPrompt)
        XCTAssertEqual(chatStore.messages, persistedMessages)
        XCTAssertFalse(chatStore.isStreaming)
        XCTAssertNil(flashcardsStore.aiChatPresentationRequest)
    }

    @MainActor
    func testAIChatStoreAppliesSnapshotAfterChatMutation() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let workspaceRuntime = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: MutatingChatService(),
            toolExecutor: workspaceRuntime,
            snapshotLoader: workspaceRuntime
        )

        chatStore.inputText = "create a card"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(flashcardsStore.cards.count, 1)
        XCTAssertEqual(flashcardsStore.cards.first?.frontText, "Front")
        XCTAssertEqual(chatStore.messages[1].text, "Saved")
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.status, .completed)
    }

    @MainActor
    func testAIChatStoreShowsStartedToolCallBeforeCompletion() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: DelayedToolCompletionChatService(),
            toolExecutor: SlowSuccessToolExecutor(pauseNanoseconds: 200_000_000),
            snapshotLoader: SlowSuccessToolExecutor(pauseNanoseconds: 200_000_000)
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.name, "sql")
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.status, .started)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.input, #"{"sql":"SHOW TABLES"}"#)
        XCTAssertNil(chatStore.messages[1].toolCalls.first?.output)

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.status, .completed)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.output, #"{"ok":true}"#)
        XCTAssertEqual(chatStore.messages[1].text, "Done")
    }

    @MainActor
    func testAIChatStoreFeedsFailedToolOutputIntoFollowUpRequest() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let chatService = RecoveringToolFailureChatService()
        let toolExecutor = RecoveringToolFailureExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: chatService,
            toolExecutor: toolExecutor,
            snapshotLoader: toolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        let requests = await chatService.snapshotRequests()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].userContext.totalCards, 1)
        XCTAssertEqual(requests[1].userContext.totalCards, 1)
        XCTAssertEqual(requests[1].messages.count, 3)
        XCTAssertEqual(requests[1].messages[1].role, "assistant")
        XCTAssertEqual(requests[1].messages[1].content?.count, 1)
        XCTAssertEqual(requests[1].messages[1].content?.first?.toolCallValue?.name, "sql")
        XCTAssertEqual(requests[1].messages[2].role, "tool")
        XCTAssertEqual(requests[1].messages[2].toolCallId, "tool-recover-1")
        XCTAssertEqual(
            requests[1].messages[2].output,
            #"{"ok":false,"error":{"code":"LOCAL_TOOL_EXECUTION_FAILED","message":"Unsupported SELECT statement"}}"#
        )
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.status, .completed)
        XCTAssertEqual(
            chatStore.messages[1].toolCalls.first?.output,
            #"{"ok":false,"error":{"code":"LOCAL_TOOL_EXECUTION_FAILED","message":"Unsupported SELECT statement"}}"#
        )
        XCTAssertEqual(chatStore.messages[1].text, "Recovered")
        XCTAssertFalse(chatStore.messages[1].isError)
    }

    @MainActor
    func testAIChatStoreStopsAfterThreeConsecutiveToolExecutionFailures() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let chatService = RepeatingToolFailureChatService()
        let toolExecutor = AlwaysFailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: chatService,
            toolExecutor: toolExecutor,
            snapshotLoader: toolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.messages.count, 2)
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 3)
        XCTAssertEqual(chatStore.messages[1].toolCalls.map(\.status), [.completed, .completed, .completed])
        XCTAssertEqual(
            chatStore.messages[1].toolCalls.last?.output,
            #"{"ok":false,"error":{"code":"LOCAL_TOOL_EXECUTION_FAILED","message":"Unsupported SELECT statement"}}"#
        )
        XCTAssertEqual(
            chatStore.messages[1].text,
            "Tool execution failed 3 times in a row. Last error: Unsupported SELECT statement"
        )
        XCTAssertTrue(chatStore.messages[1].isError)
    }

    @MainActor
    func testAIChatStoreFlushesFirstDeltaImmediatelyAndBatchesLaterDeltas() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: DelayedBurstChatService(
                firstDelta: "A",
                trailingDeltas: ["B", "C"],
                pauseAfterFirstDeltaNanoseconds: 20_000_000,
                pauseBeforeCompletionNanoseconds: 200_000_000
            ),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        for _ in 0..<10 {
            if chatStore.messages.count == 2 && chatStore.messages[1].text == "A" {
                break
            }

            try await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertEqual(chatStore.messages[1].text, "A")

        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(chatStore.messages[1].text, "A")

        try await self.waitForChatCompletion(chatStore: chatStore)
        XCTAssertEqual(chatStore.messages[1].text, "ABC")
    }

    @MainActor
    func testAIChatStoreKeepsToolCallOnlyTurnsUnchanged() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: ToolCallOnlyChatService(
                toolCall: AIChatToolCall(
                    id: "tool-1",
                    name: "web_search",
                    status: .completed,
                    input: nil,
                    output: "Searched"
                )
            ),
            toolExecutor: failingToolExecutor,
            snapshotLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertEqual(chatStore.messages[1].text, "")
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.name, "web_search")
    }
}
