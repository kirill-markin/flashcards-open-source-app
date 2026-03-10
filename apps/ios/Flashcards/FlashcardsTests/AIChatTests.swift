import Foundation
import XCTest
@testable import Flashcards

private final class InMemoryHistoryStore: AIChatHistoryStoring, @unchecked Sendable {
    var savedState: AIChatPersistedState
    private(set) var saveCallCount: Int

    init(savedState: AIChatPersistedState) {
        self.savedState = savedState
        self.saveCallCount = 0
    }

    func loadState() -> AIChatPersistedState {
        self.savedState
    }

    func saveState(state: AIChatPersistedState) async {
        self.savedState = state
        self.saveCallCount += 1
    }

    func clearState() async {
        self.savedState = AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
    }
}

private final class FailingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        XCTFail("streamTurn should not be called in this test")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: nil)
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

private struct ThrowingChatService: AIChatStreaming, @unchecked Sendable {
    let error: Error

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        throw self.error
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

private struct RepairingChatService: AIChatStreaming, @unchecked Sendable {
    let terminalError: Error?

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        await onDelta("Checking")
        await onRepairAttempt(
            AIChatRepairAttemptStatus(
                message: "Assistant is correcting list_cards.",
                attempt: 1,
                maxAttempts: 3,
                toolName: "list_cards"
            )
        )

        if let terminalError {
            throw terminalError
        }

        await onToolCallRequest(
            AIToolCallRequest(
                toolCallId: "call-1",
                name: "list_cards",
                input: "{\"limit\":null}"
            )
        )
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-123")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

private struct FailingToolExecutor: AIToolExecuting, AIChatSnapshotLoading {
    func execute(toolCallRequest: AIToolCallRequest, requestId: String?) async throws -> AIToolExecutionResult {
        XCTFail("execute should not be called in this test")
        return AIToolExecutionResult(output: "", didMutateAppState: false)
    }

    func loadSnapshot() async throws -> AppStateSnapshot {
        XCTFail("loadSnapshot should not be called in this test")
        throw LocalStoreError.uninitialized("Snapshot should not be requested")
    }
}

private struct BurstChatService: AIChatStreaming {
    let deltas: [String]

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        for delta in self.deltas {
            await onDelta(delta)
        }

        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-burst")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

private actor MutatingChatService: AIChatStreaming {
    private var callCount: Int = 0

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void,
        onRepairAttempt: @escaping @Sendable (AIChatRepairAttemptStatus) async -> Void
    ) async throws -> AITurnStreamOutcome {
        self.callCount += 1

        if self.callCount == 1 {
            let toolCallRequest = AIToolCallRequest(
                toolCallId: "tool-create-card",
                name: "create_cards",
                input: "{\"cards\":[{\"frontText\":\"Front\",\"backText\":\"Back\",\"tags\":[\"tag-a\"],\"effortLevel\":\"medium\"}]}"
            )
            await onToolCallRequest(toolCallRequest)
            return AITurnStreamOutcome(
                awaitsToolResults: true,
                requestedToolCalls: [toolCallRequest],
                requestId: "request-create"
            )
        }

        await onDelta("Saved")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [], requestId: "request-done")
    }

    func reportFailureDiagnostics(
        session: CloudLinkedSession,
        body: AIChatFailureReportBody
    ) async {
    }
}

private struct StubLocalizedError: LocalizedError {
    let message: String

    var errorDescription: String? {
        self.message
    }
}

private struct BulkDeleteCardsPayload: Decodable {
    let ok: Bool
    let deletedCardIds: [String]
    let deletedCount: Int
}

private actor DeltaRecorder {
    private var values: [String] = []

    func append(_ value: String) {
        self.values.append(value)
    }

    func snapshot() -> [String] {
        self.values
    }
}

final class AIChatTests: XCTestCase {
    override class func setUp() {
        super.setUp()
        URLProtocol.registerClass(AIChatMockUrlProtocol.self)
    }

    override class func tearDown() {
        URLProtocol.unregisterClass(AIChatMockUrlProtocol.self)
        super.tearDown()
    }

    override func tearDown() {
        AIChatMockUrlProtocol.requestHandler = nil
        super.tearDown()
    }

    func testAppTabOrderPlacesAIBeforeSettings() {
        XCTAssertEqual(AppTab.allCases, [.review, .decks, .cards, .ai, .settings])
    }

    func testHistoryStorePersistsMessagesAndModel() async throws {
        let suiteName = "ai-chat-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)

        let store = AIChatHistoryStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let message = AIChatMessage(
            id: "message-1",
            role: .assistant,
            text: "hello",
            toolCalls: [],
            timestamp: "2026-03-09T10:00:00.000Z",
            isError: false
        )

        await store.saveState(
            state: AIChatPersistedState(
                messages: [message],
                selectedModelId: "gpt-5.2"
            )
        )

        let loadedState = store.loadState()
        XCTAssertEqual(loadedState.messages, [message])
        XCTAssertEqual(loadedState.selectedModelId, "gpt-5.2")

        userDefaults.removePersistentDomain(forName: suiteName)
    }

    func testSSEParserParsesAllSupportedEventTypes() throws {
        var parser = AIChatSSEParser(decoder: JSONDecoder(), clientRequestId: "client-1", backendRequestId: "backend-1")
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"delta\",\"text\":\"Hi\"}"), nil)

        XCTAssertEqual(try parser.pushLine(""), .delta("Hi"))
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"tool_call_request\",\"toolCallId\":\"call-1\",\"name\":\"list_cards\",\"input\":\"{}\"}"), nil)
        XCTAssertEqual(
            try parser.pushLine(""),
            .toolCallRequest(AIToolCallRequest(toolCallId: "call-1", name: "list_cards", input: "{}"))
        )
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"repair_attempt\",\"message\":\"Assistant is correcting list_cards.\",\"attempt\":1,\"maxAttempts\":3,\"toolName\":\"list_cards\"}"), nil)
        XCTAssertEqual(
            try parser.pushLine(""),
            .repairAttempt(
                AIChatRepairAttemptStatus(
                    message: "Assistant is correcting list_cards.",
                    attempt: 1,
                    maxAttempts: 3,
                    toolName: "list_cards"
                )
            )
        )
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"await_tool_results\"}"), nil)
        XCTAssertEqual(try parser.pushLine(""), .awaitToolResults)
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"done\"}"), nil)
        XCTAssertEqual(try parser.pushLine(""), .done)
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"error\",\"message\":\"boom\",\"code\":\"LOCAL_CHAT_STREAM_FAILED\",\"stage\":\"stream_local_turn\",\"requestId\":\"backend-1\"}"), nil)
        XCTAssertEqual(
            try parser.pushLine(""),
            .error(
                AIChatBackendError(
                    message: "boom",
                    code: "LOCAL_CHAT_STREAM_FAILED",
                    stage: "stream_local_turn",
                    requestId: "backend-1"
                )
            )
        )
    }

    func testSSEParserClassifiesMultipleJSONObjectsAsFramingError() {
        var parser = AIChatSSEParser(decoder: JSONDecoder(), clientRequestId: "client-1", backendRequestId: "backend-1")

        XCTAssertNoThrow(try parser.pushLine("data: {\"type\":\"delta\",\"text\":\"Hi\"}"))
        XCTAssertNoThrow(try parser.pushLine("data: {\"type\":\"done\"}"))

        XCTAssertThrowsError(try parser.pushLine("")) { error in
            guard case .invalidSSEFraming(let diagnostics) = error as? AIChatServiceError else {
                return XCTFail("Expected invalidSSEFraming, received \(error)")
            }

            XCTAssertEqual(diagnostics.clientRequestId, "client-1")
            XCTAssertEqual(diagnostics.backendRequestId, "backend-1")
            XCTAssertEqual(diagnostics.errorKind, .invalidSSEFraming)
            XCTAssertEqual(diagnostics.stage, .finishingEvent)
            XCTAssertEqual(diagnostics.eventType, "delta")
        }
    }

    @MainActor
    func testLocalToolExecutorReadsWorkspaceContextAndCreatesConfirmedCard() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let workspaceContextResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-1",
                name: "get_workspace_context",
                input: "{}"
            ),
            requestId: "request-1"
        )
        let workspaceContext = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(workspaceContextResult.output.utf8)) as? [String: Any]
        )
        let workspace = try XCTUnwrap(workspaceContext["workspace"] as? [String: Any])
        XCTAssertEqual(workspace["name"] as? String, "Local Workspace")

        let createdCardResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-2",
                name: "create_cards",
                input: "{\"cards\":[{\"frontText\":\"Front\",\"backText\":\"Back\",\"tags\":[\"tag-a\"],\"effortLevel\":\"medium\"}]}"
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardResult.output.utf8))
        XCTAssertEqual(createdCards.count, 1)
        XCTAssertEqual(createdCards[0].frontText, "Front")
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.cards.count, 1)
    }

    @MainActor
    func testLocalToolExecutorCreatesCardsWithoutConfirmationText() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-bulk-create",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))
        XCTAssertEqual(createdCards.count, 2)
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.cards.count, 2)
    }

    @MainActor
    func testLocalToolExecutorGetCardsReturnsRequestedOrderAndFailsForMissingCard() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-for-get",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))

        let fetchedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-get-cards",
                name: "get_cards",
                input: """
                {"cardIds":["\(createdCards[1].cardId)","\(createdCards[0].cardId)"]}
                """
            ),
            requestId: "request-1"
        )
        let fetchedCards = try JSONDecoder().decode([Card].self, from: Data(fetchedCardsResult.output.utf8))
        XCTAssertEqual(fetchedCards.map(\.cardId), [createdCards[1].cardId, createdCards[0].cardId])

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-get-missing-card",
                    name: "get_cards",
                    input: "{\"cardIds\":[\"missing-card\"]}"
                ),
                requestId: "request-1"
            )
            XCTFail("Expected missing card error")
        } catch let error as LocalStoreError {
            XCTAssertEqual(error.localizedDescription, "Card not found")
        }
    }

    @MainActor
    func testLocalToolExecutorWrapsInvalidInputWithDiagnostics() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-invalid",
                    name: "list_cards",
                    input: "{\"limit\":5}\n{\"limit\":10}"
                ),
                requestId: "request-123"
            )
            XCTFail("Expected invalid tool input error")
        } catch let error as AIToolExecutionError {
            guard case .invalidToolInput(let requestId, let toolName, let toolCallId, _, let decoderSummary, let rawInputSnippet) = error else {
                return XCTFail("Expected invalidToolInput, received \(error.localizedDescription)")
            }

            XCTAssertEqual(requestId, "request-123")
            XCTAssertEqual(toolName, "list_cards")
            XCTAssertEqual(toolCallId, "call-invalid")
            XCTAssertFalse(decoderSummary.isEmpty)
            XCTAssertEqual(rawInputSnippet, "{\"limit\":5}\n{\"limit\":10}")
        }
    }

    @MainActor
    func testLocalToolExecutorCreatesUpdatesAndDeletesCardsInBulk() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-create-cards",
                name: "create_cards",
                input: """
                {"cards":[
                    {"frontText":"Front 1","backText":"Back 1","tags":["tag-a"],"effortLevel":"medium"},
                    {"frontText":"Front 2","backText":"Back 2","tags":["tag-b"],"effortLevel":"fast"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsResult.output.utf8))
        XCTAssertEqual(createdCards.count, 2)
        XCTAssertTrue(createdCardsResult.didMutateAppState)

        let updatedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-update-cards",
                name: "update_cards",
                input: """
                {"updates":[
                    {"cardId":"\(createdCards[0].cardId)","frontText":"Updated Front 1"},
                    {"cardId":"\(createdCards[1].cardId)","tags":["tag-c","tag-d"],"effortLevel":"long"}
                ]}
                """
            ),
            requestId: "request-1"
        )
        let updatedCards = try JSONDecoder().decode([Card].self, from: Data(updatedCardsResult.output.utf8))
        XCTAssertEqual(updatedCards.count, 2)
        XCTAssertEqual(
            Set(updatedCards.map { card in
                card.cardId
            }),
            Set(createdCards.map { card in
                card.cardId
            })
        )
        XCTAssertTrue(updatedCards.contains { card in
            card.cardId == createdCards[0].cardId && card.frontText == "Updated Front 1"
        })
        XCTAssertTrue(updatedCards.contains { card in
            card.cardId == createdCards[1].cardId && card.tags == ["tag-c", "tag-d"] && card.effortLevel == .long
        })

        let deletedCardsResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-delete-cards",
                name: "delete_cards",
                input: """
                {"cardIds":["\(createdCards[0].cardId)","\(createdCards[1].cardId)"]}
                """
            ),
            requestId: "request-1"
        )
        let deletedCardsPayload = try JSONDecoder().decode(BulkDeleteCardsPayload.self, from: Data(deletedCardsResult.output.utf8))
        XCTAssertTrue(deletedCardsPayload.ok)
        XCTAssertEqual(deletedCardsPayload.deletedCount, 2)
        XCTAssertEqual(Set(deletedCardsPayload.deletedCardIds), Set(createdCards.map(\.cardId)))
        let snapshot = try await executor.loadSnapshot()
        XCTAssertEqual(snapshot.cards.count, 0)
    }

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
    func testLocalToolExecutorReadsLatestCommittedStateBetweenCalls() async throws {
        let flashcardsStore = try self.makeStore()
        let databaseURL = try XCTUnwrap(flashcardsStore.localDatabaseURL)
        let executor = LocalAIToolExecutor(
            databaseURL: databaseURL,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let initialListResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-initial",
                name: "list_cards",
                input: "{}"
            ),
            requestId: "request-list"
        )
        let initialCards = try JSONDecoder().decode([Card].self, from: Data(initialListResult.output.utf8))
        XCTAssertEqual(initialCards.count, 0)

        try flashcardsStore.saveCard(
            input: CardEditorInput(
                frontText: "Fresh Front",
                backText: "Fresh Back",
                tags: ["fresh"],
                effortLevel: .medium
            ),
            editingCardId: nil
        )

        let updatedListResult = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-list-updated",
                name: "list_cards",
                input: "{}"
            ),
            requestId: "request-list"
        )
        let updatedCards = try JSONDecoder().decode([Card].self, from: Data(updatedListResult.output.utf8))
        XCTAssertEqual(updatedCards.count, 1)
        XCTAssertEqual(updatedCards.first?.frontText, "Fresh Front")
    }

    func testLocalDatabaseEnablesWALForConcurrentConnections() throws {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

        let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let primary = try LocalDatabase(databaseURL: databaseURL)
        let secondary = try LocalDatabase(databaseURL: databaseURL)

        XCTAssertEqual(try primary.loadJournalMode().lowercased(), "wal")
        XCTAssertEqual(try secondary.loadJournalMode().lowercased(), "wal")
    }

    func testAIChatServiceFormatsApiErrorsWithRequestId() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat/local-turn")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 403,
                httpVersion: nil,
                headerFields: [
                    "Content-Type": "application/json",
                    "X-Request-Id": "request-123"
                ]
            )!
            let data = """
            {"error":"Authentication failed. Sign in again.","requestId":"request-123","code":"AUTH_UNAUTHORIZED"}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await service.streamTurn(
                session: CloudLinkedSession(
                    userId: "user-1",
                    workspaceId: "workspace-1",
                    email: "user@example.com",
                    apiBaseUrl: "https://api.example.com",
                    bearerToken: "test-token"
                ),
                request: AILocalChatRequestBody(
                    messages: [AILocalChatWireMessage(
                        role: "user",
                        content: "hello",
                        toolCalls: nil,
                        toolCallId: nil,
                        name: nil,
                        output: nil
                    )],
                    model: aiChatDefaultModelId,
                    timezone: "Europe/Madrid"
                ),
                onDelta: { _ in },
                onToolCallRequest: { _ in },
                onRepairAttempt: { _ in }
            )
            XCTFail("Expected invalid response error")
        } catch let error as AIChatServiceError {
            XCTAssertEqual(
                error.errorDescription,
                """
                AI chat request failed with status 403: Authentication failed. Sign in again. Reference: request-123
                Request: request-123
                Stage: response_not_ok
                """
            )
        }
    }

    func testAIChatServiceReadsSequentialSSEEventsWithoutFramingFailure() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat/local-turn")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: [
                    "Content-Type": "text/event-stream",
                    "X-Chat-Request-Id": "request-stream-1"
                ]
            )!
            let data = """
            data: {"type":"delta","text":"Hi"}

            data: {"type":"delta","text":"!"}

            data: {"type":"done"}

            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let recorder = DeltaRecorder()

        let outcome = try await service.streamTurn(
            session: CloudLinkedSession(
                userId: "user-1",
                workspaceId: "workspace-1",
                email: "user@example.com",
                apiBaseUrl: "https://api.example.com",
                bearerToken: "test-token"
            ),
            request: AILocalChatRequestBody(
                messages: [AILocalChatWireMessage(
                    role: "user",
                    content: "say hi",
                    toolCalls: nil,
                    toolCallId: nil,
                    name: nil,
                    output: nil
                )],
                model: aiChatDefaultModelId,
                timezone: "Europe/Madrid"
            ),
            onDelta: { text in
                await recorder.append(text)
            },
            onToolCallRequest: { _ in },
            onRepairAttempt: { _ in }
        )

        let deltas = await recorder.snapshot()
        XCTAssertEqual(deltas, ["Hi", "!"])
        XCTAssertEqual(outcome.requestId, "request-stream-1")
        XCTAssertFalse(outcome.awaitsToolResults)
        XCTAssertTrue(outcome.requestedToolCalls.isEmpty)
    }

    @MainActor
    private func makeStore() throws -> FlashcardsStore {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

        let suiteName = "flashcards-store-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        return FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: try LocalDatabase(
                databaseURL: databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
            ),
            cloudAuthService: CloudAuthService(),
            credentialStore: CloudCredentialStore(
                encoder: JSONEncoder(),
                decoder: JSONDecoder(),
                service: "tests-\(UUID().uuidString)",
                account: "primary"
            ),
            initialGlobalErrorMessage: ""
        )
    }

    @MainActor
    private func makeLinkedStore() throws -> FlashcardsStore {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

        let suiteName = "flashcards-linked-store-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let database = try LocalDatabase(
            databaseURL: databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        )
        try database.updateCloudSettings(
            cloudState: .linked,
            linkedUserId: "user-1",
            linkedWorkspaceId: "workspace-1",
            linkedEmail: "user@example.com"
        )

        let credentialStore = CloudCredentialStore(
            encoder: encoder,
            decoder: decoder,
            service: "tests-\(UUID().uuidString)",
            account: "linked"
        )
        try credentialStore.saveCredentials(
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: isoTimestamp(date: Date().addingTimeInterval(3600))
            )
        )

        return FlashcardsStore(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: CloudAuthService(),
            credentialStore: credentialStore,
            initialGlobalErrorMessage: ""
        )
    }

    @MainActor
    private func waitForChatCompletion(chatStore: AIChatStore) async throws {
        for _ in 0..<50 {
            if chatStore.isStreaming == false {
                return
            }

            try await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTFail("Timed out waiting for chat completion")
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AIChatMockUrlProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private final class AIChatMockUrlProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = AIChatMockUrlProtocol.requestHandler else {
            XCTFail("AIChatMockUrlProtocol.requestHandler is not set")
            return
        }

        do {
            let (response, data) = try handler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
