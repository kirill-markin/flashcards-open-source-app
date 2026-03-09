import Foundation
import XCTest
@testable import Flashcards

private final class InMemoryHistoryStore: AIChatHistoryStoring {
    var savedState: AIChatPersistedState

    init(savedState: AIChatPersistedState) {
        self.savedState = savedState
    }

    func loadState() -> AIChatPersistedState {
        self.savedState
    }

    func saveState(state: AIChatPersistedState) {
        self.savedState = state
    }

    func clearState() {
        self.savedState = AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
    }
}

private final class FailingChatService: AIChatStreaming, @unchecked Sendable {
    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void
    ) async throws -> AITurnStreamOutcome {
        XCTFail("streamTurn should not be called in this test")
        return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: [])
    }
}

private struct FailingToolExecutor: AIToolExecuting {
    func execute(toolCallRequest: AIToolCallRequest, latestUserText: String) async throws -> String {
        XCTFail("execute should not be called in this test")
        return ""
    }
}

private struct BulkDeleteCardsPayload: Decodable {
    let ok: Bool
    let deletedCardIds: [String]
    let deletedCount: Int
}

final class AIChatTests: XCTestCase {
    func testAppTabOrderPlacesAIBeforeSettings() {
        XCTAssertEqual(AppTab.allCases, [.review, .decks, .cards, .ai, .settings])
    }

    func testHistoryStorePersistsMessagesAndModel() throws {
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

        store.saveState(
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
        var parser = AIChatSSEParser(decoder: JSONDecoder())
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"delta\",\"text\":\"Hi\"}"), nil)

        XCTAssertEqual(try parser.pushLine(""), .delta("Hi"))
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"tool_call_request\",\"toolCallId\":\"call-1\",\"name\":\"list_cards\",\"input\":\"{}\"}"), nil)
        XCTAssertEqual(
            try parser.pushLine(""),
            .toolCallRequest(AIToolCallRequest(toolCallId: "call-1", name: "list_cards", input: "{}"))
        )
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"await_tool_results\"}"), nil)
        XCTAssertEqual(try parser.pushLine(""), .awaitToolResults)
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"done\"}"), nil)
        XCTAssertEqual(try parser.pushLine(""), .done)
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"error\",\"message\":\"boom\"}"), nil)
        XCTAssertEqual(try parser.pushLine(""), .error("boom"))
    }

    @MainActor
    func testLocalToolExecutorReadsWorkspaceContextAndCreatesConfirmedCard() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = LocalAIToolExecutor(
            flashcardsStore: flashcardsStore,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let workspaceContextJson = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-1",
                name: "get_workspace_context",
                input: "{}"
            ),
            latestUserText: "show me the current workspace"
        )
        let workspaceContext = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(workspaceContextJson.utf8)) as? [String: Any]
        )
        let workspace = try XCTUnwrap(workspaceContext["workspace"] as? [String: Any])
        XCTAssertEqual(workspace["name"] as? String, "Local Workspace")

        do {
            _ = try await executor.execute(
                toolCallRequest: AIToolCallRequest(
                    toolCallId: "call-2",
                    name: "create_card",
                    input: "{\"frontText\":\"Front\",\"backText\":\"Back\",\"tags\":[\"tag-a\"],\"effortLevel\":\"medium\"}"
                ),
                latestUserText: "please create a card"
            )
            XCTFail("Expected write confirmation error")
        } catch let error as AIToolExecutionError {
            guard case .writeConfirmationRequired = error else {
                return XCTFail("Expected write confirmation error, received \(error.localizedDescription)")
            }
        }

        let createdCardJson = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-3",
                name: "create_card",
                input: "{\"frontText\":\"Front\",\"backText\":\"Back\",\"tags\":[\"tag-a\"],\"effortLevel\":\"medium\"}"
            ),
            latestUserText: "yes, do it"
        )
        let createdCard = try JSONDecoder().decode(Card.self, from: Data(createdCardJson.utf8))
        XCTAssertEqual(createdCard.frontText, "Front")
        XCTAssertEqual(flashcardsStore.cards.count, 1)
    }

    @MainActor
    func testLocalToolExecutorRejectsBulkCreateWithoutConfirmation() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = LocalAIToolExecutor(
            flashcardsStore: flashcardsStore,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await executor.execute(
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
                latestUserText: "please create these cards"
            )
            XCTFail("Expected write confirmation error")
        } catch let error as AIToolExecutionError {
            guard case .writeConfirmationRequired = error else {
                return XCTFail("Expected write confirmation error, received \(error.localizedDescription)")
            }
        }
    }

    @MainActor
    func testLocalToolExecutorCreatesUpdatesAndDeletesCardsInBulk() async throws {
        let flashcardsStore = try self.makeStore()
        let executor = LocalAIToolExecutor(
            flashcardsStore: flashcardsStore,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let createdCardsJson = try await executor.execute(
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
            latestUserText: "yes, do it"
        )
        let createdCards = try JSONDecoder().decode([Card].self, from: Data(createdCardsJson.utf8))
        XCTAssertEqual(createdCards.count, 2)
        XCTAssertEqual(flashcardsStore.cards.count, 2)

        let updatedCardsJson = try await executor.execute(
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
            latestUserText: "yes, apply these changes"
        )
        let updatedCards = try JSONDecoder().decode([Card].self, from: Data(updatedCardsJson.utf8))
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

        let deletedCardsJson = try await executor.execute(
            toolCallRequest: AIToolCallRequest(
                toolCallId: "call-delete-cards",
                name: "delete_cards",
                input: """
                {"cardIds":["\(createdCards[0].cardId)","\(createdCards[1].cardId)"]}
                """
            ),
            latestUserText: "yes, proceed"
        )
        let deletedCardsPayload = try JSONDecoder().decode(BulkDeleteCardsPayload.self, from: Data(deletedCardsJson.utf8))
        XCTAssertTrue(deletedCardsPayload.ok)
        XCTAssertEqual(deletedCardsPayload.deletedCount, 2)
        XCTAssertEqual(Set(deletedCardsPayload.deletedCardIds), Set(createdCards.map(\.cardId)))
        XCTAssertEqual(flashcardsStore.cards.count, 0)
    }

    @MainActor
    func testAIChatStoreBlocksSendWhenCloudIsNotLinked() throws {
        let flashcardsStore = try self.makeStore()
        let chatStore = AIChatStore(
            flashcardsStore: flashcardsStore,
            historyStore: InMemoryHistoryStore(
                savedState: AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
            ),
            chatService: FailingChatService(),
            toolExecutor: FailingToolExecutor()
        )

        chatStore.inputText = "hello"
        chatStore.sendMessage()

        XCTAssertEqual(chatStore.messages.count, 0)
        XCTAssertEqual(chatStore.errorMessage, "AI chat requires cloud sign-in.")
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
}
