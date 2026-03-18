import Foundation
import XCTest
@testable import Flashcards

final class AIChatCoreAndParserTests: AIChatTestCaseBase {
    func testAppTabOrderPlacesAIBeforeSettings() {
        XCTAssertEqual(AppTab.allCases, [.review, .cards, .ai, .settings])
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
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"tool_call_request\",\"toolCallId\":\"call-1\",\"name\":\"sql\",\"input\":\"{\\\"sql\\\":\\\"SHOW TABLES\\\"}\"}"), nil)
        XCTAssertEqual(
            try parser.pushLine(""),
            .toolCallRequest(AIToolCallRequest(toolCallId: "call-1", name: "sql", input: "{\"sql\":\"SHOW TABLES\"}"))
        )
        XCTAssertEqual(try parser.pushLine("data: {\"type\":\"repair_attempt\",\"message\":\"Assistant is correcting sql.\",\"attempt\":1,\"maxAttempts\":3,\"toolName\":\"sql\"}"), nil)
        XCTAssertEqual(
            try parser.pushLine(""),
            .repairAttempt(
                AIChatRepairAttemptStatus(
                    message: "Assistant is correcting sql.",
                    attempt: 1,
                    maxAttempts: 3,
                    toolName: "sql"
                )
            )
        )
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

    func testTypingIndicatorShowsOnlyForLastStreamingAssistantMessage() {
        let assistantMessage = AIChatMessage(
            id: "message-1",
            role: .assistant,
            text: "",
            toolCalls: [],
            timestamp: "2026-03-09T10:00:00.000Z",
            isError: false
        )
        let userMessage = AIChatMessage(
            id: "message-2",
            role: .user,
            text: "hello",
            toolCalls: [],
            timestamp: "2026-03-09T10:00:01.000Z",
            isError: false
        )

        XCTAssertTrue(
            aiChatShouldShowTypingIndicator(
                message: assistantMessage,
                isLastMessage: true,
                isStreaming: true
            )
        )
        XCTAssertFalse(
            aiChatShouldShowTypingIndicator(
                message: assistantMessage,
                isLastMessage: false,
                isStreaming: true
            )
        )
        XCTAssertFalse(
            aiChatShouldShowTypingIndicator(
                message: assistantMessage,
                isLastMessage: true,
                isStreaming: false
            )
        )
        XCTAssertFalse(
            aiChatShouldShowTypingIndicator(
                message: userMessage,
                isLastMessage: true,
                isStreaming: true
            )
        )
    }

    func testMakeAIChatUserContextStoresProvidedTotalCards() {
        XCTAssertEqual(
            makeAIChatUserContext(totalCards: 3),
            AILocalChatUserContext(totalCards: 3)
        )
    }

    func testMakeAIChatUserContextSupportsZeroCards() {
        XCTAssertEqual(
            makeAIChatUserContext(totalCards: 0),
            AILocalChatUserContext(totalCards: 0)
        )
    }

    @MainActor

    func testLocalDatabaseEnablesWALForConcurrentConnections() throws {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)

        let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let primary = try LocalDatabase(databaseURL: databaseURL)
        let secondary = try LocalDatabase(databaseURL: databaseURL)
        self.addTeardownBlock {
            try secondary.close()
            try primary.close()
        }

        XCTAssertEqual(try primary.loadJournalMode().lowercased(), "wal")
        XCTAssertEqual(try secondary.loadJournalMode().lowercased(), "wal")
    }

}
