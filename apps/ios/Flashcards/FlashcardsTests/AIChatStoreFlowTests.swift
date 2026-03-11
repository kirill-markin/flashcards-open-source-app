import Foundation
import XCTest
@testable import Flashcards

final class AIChatStoreFlowTests: AIChatTestCaseBase {
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

        chatStore.cancelStreaming()
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
}
