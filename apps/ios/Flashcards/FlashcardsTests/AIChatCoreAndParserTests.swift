import Foundation
import XCTest
@testable import Flashcards

final class AIChatCoreAndParserTests: AIChatTestCaseBase {
    func testAppTabOrderPlacesAIBeforeSettings() {
        XCTAssertEqual(AppTab.allCases, [.review, .cards, .ai, .settings])
    }

    func testHistoryStorePersistsMessagesAndSessionSnapshotMetadata() async throws {
        let suiteName = "ai-chat-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        userDefaults.set(1, forKey: "ai-chat-history-cleanup-version")

        let store = AIChatHistoryStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let message = AIChatMessage(
            id: "message-1",
            role: .assistant,
            content: [.text("hello")],
            timestamp: "2026-03-09T10:00:00.000Z",
            isError: false
        )

        await store.saveState(
            state: AIChatPersistedState(
                messages: [message],
                chatSessionId: "session-1",
                lastKnownChatConfig: aiChatDefaultServerConfig
            )
        )

        let loadedState = store.loadState()
        XCTAssertEqual(loadedState.messages, [message])
        XCTAssertEqual(loadedState.chatSessionId, "session-1")
        XCTAssertEqual(loadedState.lastKnownChatConfig, aiChatDefaultServerConfig)

        userDefaults.removePersistentDomain(forName: suiteName)
    }

    func testAIChatMessageDecodesBackendTimestampMilliseconds() throws {
        let data = """
        {
          "messageId": "message-1",
          "role": "assistant",
          "content": [{ "type": "text", "text": "hello" }],
          "timestamp": 1741514400000,
          "isError": false
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(AIChatMessage.self, from: data)

        XCTAssertEqual(decoded.id, "message-1")
        XCTAssertEqual(decoded.text, "hello")
        XCTAssertFalse(decoded.timestamp.isEmpty)
    }

    func testAIChatContentPartEncodesToolCallWithNewIdFieldOnly() throws {
        let data = try JSONEncoder().encode(
            AIChatContentPart.toolCall(
                AIChatToolCall(
                    id: "tool-1",
                    name: "sql",
                    status: .completed,
                    input: "select 1",
                    output: "[1]"
                )
            )
        )

        let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(jsonObject["type"] as? String, "tool_call")
        XCTAssertEqual(jsonObject["id"] as? String, "tool-1")
        XCTAssertNil(jsonObject["toolCallId"])
    }

    func testTypingIndicatorShowsOnlyForLastStreamingAssistantMessage() {
        let assistantMessage = AIChatMessage(
            id: "message-1",
            role: .assistant,
            content: [],
            timestamp: "2026-03-09T10:00:00.000Z",
            isError: false
        )
        let userMessage = AIChatMessage(
            id: "message-2",
            role: .user,
            content: [.text("hello")],
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
}
