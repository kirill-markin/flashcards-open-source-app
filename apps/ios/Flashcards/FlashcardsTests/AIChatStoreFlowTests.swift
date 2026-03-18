import Foundation
import XCTest
@testable import Flashcards

@MainActor
private func requireMessageCount(
    _ chatStore: AIChatStore,
    expectedCount: Int,
    file: StaticString = #filePath,
    line: UInt = #line
) -> Bool {
    XCTAssertEqual(chatStore.messages.count, expectedCount, file: file, line: line)
    return chatStore.messages.count == expectedCount
}

final class AIChatStoreFlowTests: AIChatTestCaseBase {
    @MainActor
    func testAIChatStoreRequiresConsentBeforeGuestAIChatCanStart() throws {
        let flashcardsStore = try self.makeStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        XCTAssertEqual(chatStore.messages.count, 0)
        XCTAssertEqual(
            chatStore.activeAlert,
            .generalError(message: aiChatExternalProviderConsentRequiredMessage)
        )
    }

    @MainActor
    func testAIChatStoreBlocksSendWhenExternalAIConsentIsMissing() throws {
        let flashcardsStore = try self.makeLinkedStoreWithoutAIConsent()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        XCTAssertEqual(chatStore.messages.count, 0)
        XCTAssertEqual(
            chatStore.activeAlert,
            .generalError(message: aiChatExternalProviderConsentRequiredMessage)
        )
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertNil(chatStore.activeAlert)
        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertNil(chatStore.repairStatus)
        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        XCTAssertNil(chatStore.repairStatus)
        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            idTokenExpiresAt: formatIsoTimestamp(date: Date().addingTimeInterval(-300))
        )
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()

        try await Task.sleep(nanoseconds: 50_000_000)

        let requests = requestRecorder.snapshot()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.url?.path, "/api/refresh-token")
        XCTAssertEqual(chatStore.messages, [])
        XCTAssertNil(chatStore.activeAlert)
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
            idTokenExpiresAt: formatIsoTimestamp(date: Date().addingTimeInterval(-300))
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
            localContextLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()
        try await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(chatStore.messages, [])
        XCTAssertNil(chatStore.activeAlert)
        XCTAssertFalse(chatStore.isStreaming)
    }

    @MainActor
    func testAIChatStoreWarmUpIsNoOpWhenExternalAIConsentIsMissing() async throws {
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

        let flashcardsStore = try self.makeLinkedStoreWithoutAIConsent()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()
        try await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(requestRecorder.snapshot().count, 0)
        XCTAssertEqual(chatStore.messages, [])
        XCTAssertNil(chatStore.activeAlert)
        XCTAssertFalse(chatStore.isStreaming)
    }

    @MainActor
    func testAIChatStoreBlocksAttachmentWhenExternalAIConsentIsMissing() throws {
        let flashcardsStore = try self.makeLinkedStoreWithoutAIConsent()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.appendAttachment(
            AIChatAttachment(
                id: "attachment-1",
                fileName: "notes.txt",
                mediaType: "text/plain",
                base64Data: Data("hello".utf8).base64EncodedString()
            )
        )

        XCTAssertTrue(chatStore.pendingAttachments.isEmpty)
        XCTAssertEqual(
            chatStore.activeAlert,
            .generalError(message: aiChatExternalProviderConsentRequiredMessage)
        )
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
            idTokenExpiresAt: formatIsoTimestamp(date: Date().addingTimeInterval(-300))
        )
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.warmUpSessionIfNeeded()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(chatStore.messages, [])
        XCTAssertNil(chatStore.activeAlert)
        XCTAssertFalse(chatStore.isStreaming)
    }

    @MainActor
    func testAIChatStoreSendMessageClearsDraftAndAttachmentsBeforeStreaming() async throws {
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
            localContextLoader: failingToolExecutor
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

        try await self.waitForChatStart(chatStore: chatStore)
        XCTAssertTrue(chatStore.isStreaming)
        XCTAssertEqual(chatStore.inputText, "")
        XCTAssertEqual(chatStore.pendingAttachments, [])
        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            localContextLoader: failingToolExecutor
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
    func testAIChatStoreKeepsTypedDraftAfterStoppingStreaming() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: SuspendingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()
        try await self.waitForChatStart(chatStore: chatStore)
        XCTAssertTrue(chatStore.isStreaming)

        chatStore.inputText = "follow up"
        chatStore.cancelStreaming()

        XCTAssertFalse(chatStore.isStreaming)
        XCTAssertEqual(chatStore.inputText, "follow up")
    }

    @MainActor
    func testAIChatStoreKeepsAttachmentsAddedDuringStreamingAfterStopping() async throws {
        let flashcardsStore = try self.makeLinkedStore()
        let failingToolExecutor = FailingToolExecutor()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: SuspendingChatService(),
            toolExecutor: failingToolExecutor,
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()
        try await self.waitForChatStart(chatStore: chatStore)
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
            localContextLoader: failingToolExecutor
        )

        let navigation = AppNavigationModel()
        navigation.openAICardCreation()
        let request = try XCTUnwrap(navigation.aiChatPresentationRequest)
        chatStore.applyPresentationRequest(request: request)
        navigation.clearAIChatPresentationRequest()

        XCTAssertEqual(chatStore.inputText, aiChatCreateCardDraftPrompt)
        XCTAssertEqual(chatStore.messages, persistedMessages)
        XCTAssertFalse(chatStore.isStreaming)
        XCTAssertNil(navigation.aiChatPresentationRequest)
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
            localContextLoader: SlowSuccessToolExecutor(pauseNanoseconds: 200_000_000)
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await Task.sleep(nanoseconds: 50_000_000)

        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.name, "sql")
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.status, .started)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.input, #"{"sql":"SHOW TABLES"}"#)
        XCTAssertNil(chatStore.messages[1].toolCalls.first?.output)

        try await self.waitForChatCompletion(chatStore: chatStore)

        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.status, .completed)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.output, #"{"ok":true}"#)
        XCTAssertEqual(chatStore.messages[1].text, "Done")
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        for _ in 0..<10 {
            if chatStore.messages.count == 2 && chatStore.messages[1].text == "A" {
                break
            }

            try await Task.sleep(nanoseconds: 10_000_000)
        }

        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
        XCTAssertEqual(chatStore.messages[1].text, "A")

        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(chatStore.messages[1].text, "A")

        try await self.waitForChatCompletion(chatStore: chatStore)
        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
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
            localContextLoader: failingToolExecutor
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        try await self.waitForChatCompletion(chatStore: chatStore)

        guard requireMessageCount(chatStore, expectedCount: 2) else {
            return
        }
        XCTAssertEqual(chatStore.messages[1].text, "")
        XCTAssertEqual(chatStore.messages[1].toolCalls.count, 1)
        XCTAssertEqual(chatStore.messages[1].toolCalls.first?.name, "web_search")
    }
}
